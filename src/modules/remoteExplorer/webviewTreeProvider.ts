import * as vscode from 'vscode';
import { upath } from '../../core';
import RemoteTreeData, { ExplorerItem, ExplorerRoot } from './treeDataProvider';

interface TreeNode {
  id: string;
  name: string;
  isDirectory: boolean;
  isRoot: boolean;
  path: string;
  level: number;
  parentId?: string;
  metadata: {
    size?: number;
    mtime?: number;
    mode?: number;
    owner?: string;
    group?: string;
  };
  item: ExplorerItem;
}

interface ColumnVisibility {
  showSize: boolean;
  showPermissions: boolean;
  showOwner: boolean;
  showModified: boolean;
}

export class WebviewTreeProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _treeDataProvider: RemoteTreeData;
  private _expandedNodes: Set<string> = new Set();
  private _itemCache: Map<string, ExplorerItem> = new Map();
  private _columnVisibility: ColumnVisibility = {
    showSize: true,
    showPermissions: false,
    showOwner: false,
    showModified: true
  };

  constructor(
    private readonly _extensionUri: vscode.Uri,
    treeDataProvider: RemoteTreeData
  ) {
    this._treeDataProvider = treeDataProvider;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'refresh':
          await this.refresh();
          break;
        case 'expand':
          await this.toggleExpand(data.nodeId);
          break;
        case 'openFile':
          await this.openFile(data.nodeId);
          break;
        case 'getChildren':
          await this.loadChildren(data.nodeId);
          break;
        case 'toggleColumn':
          await this.toggleColumn(data.column);
          break;
        case 'executeCommand':
          await this.executeCommand(data.command, data.nodeId);
          break;
      }
    });

    // Initial load
    this.refresh();
  }

  public async refresh(item?: ExplorerItem) {
    await this._treeDataProvider.refresh(item);
    await this.updateView();
  }

  private async updateView() {
    if (!this._view) {
      return;
    }

    const roots = await this._treeDataProvider.getChildren();
    
    // Get column visibility from first root's config
    if (roots.length > 0) {
      const root = roots[0] as ExplorerRoot;
      const explorerSettings = root.explorerContext.config.remoteExplorer;
      this._columnVisibility = {
        showSize: explorerSettings?.showSize ?? true,
        showPermissions: explorerSettings?.showPermissions ?? false,
        showOwner: explorerSettings?.showOwner ?? false,
        showModified: explorerSettings?.showModified ?? true
      };
    }
    
    const treeData = await this.buildTreeData(roots, 0);

    this._view.webview.postMessage({
      type: 'update',
      data: treeData,
      expandedNodes: Array.from(this._expandedNodes),
      columnVisibility: this._columnVisibility
    });
  }

  private async buildTreeData(items: ExplorerItem[], level: number, parentId?: string): Promise<TreeNode[]> {
    const result: TreeNode[] = [];

    for (const item of items) {
      const isRoot = (item as ExplorerRoot).explorerContext !== undefined;
      const fileName = isRoot
        ? (item as ExplorerRoot).explorerContext.fileService.name
        : upath.basename(item.resource.fsPath);

      const nodeId = item.resource.uri.toString();
      this._itemCache.set(nodeId, item);

      const treeNode: TreeNode = {
        id: nodeId,
        name: fileName,
        isDirectory: item.isDirectory,
        isRoot,
        path: item.resource.fsPath,
        level,
        parentId,
        metadata: {},
        item
      };

      // Add metadata for non-root items
      if (!isRoot) {
        const fileEntry = (item as any);
        
        if (fileEntry) {
          treeNode.metadata = {
            size: !item.isDirectory && 'size' in fileEntry ? fileEntry.size : undefined,
            mtime: 'mtime' in fileEntry ? fileEntry.mtime : undefined,
            mode: fileEntry.mode,
            owner: (fileEntry as any).owner,
            group: (fileEntry as any).group
          };
        }
      }

      result.push(treeNode);

      // If this node is expanded, load its children
      if (item.isDirectory && this._expandedNodes.has(nodeId)) {
        try {
          const children = await this._treeDataProvider.getChildren(item);
          const childNodes = await this.buildTreeData(children, level + 1, nodeId);
          result.push(...childNodes);
        } catch (error) {
          console.error('Error loading children:', error);
        }
      }
    }

    return result;
  }

  private async toggleExpand(nodeId: string) {
    if (this._expandedNodes.has(nodeId)) {
      this._expandedNodes.delete(nodeId);
    } else {
      this._expandedNodes.add(nodeId);
    }
    await this.updateView();
  }

  private async loadChildren(nodeId: string) {
    const item = this._itemCache.get(nodeId);
    if (!item || !item.isDirectory) {
      return;
    }

    this._expandedNodes.add(nodeId);
    await this.updateView();
  }

  private async openFile(nodeId: string) {
    const item = this._itemCache.get(nodeId);
    if (!item || item.isDirectory) {
      return;
    }

    this._treeDataProvider.showItem(item);
  }

  private async executeCommand(command: string, nodeId: string) {
    const item = this._itemCache.get(nodeId);
    if (!item) {
      return;
    }

    try {
      await vscode.commands.executeCommand(command, item);
      // Refresh after command execution
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to execute command: ${error.message}`);
    }
  }

  private async toggleColumn(column: keyof ColumnVisibility) {
    // Get the first root to update its config
    const roots = await this._treeDataProvider.getChildren();
    if (roots.length === 0) {
      return;
    }

    const root = roots[0] as ExplorerRoot;
    const fileService = root.explorerContext.fileService;
    const config = fileService.getConfig();
    
    // Toggle the column visibility
    if (!config.remoteExplorer) {
      config.remoteExplorer = { order: 0 };
    }
    
    const currentValue = config.remoteExplorer[column] ?? (column === 'showSize' || column === 'showModified');
    config.remoteExplorer[column] = !currentValue;
    
    // Update the config file
    await this.updateConfigFile(fileService, config);
    
    // Refresh the view
    await this.updateView();
  }

  private async updateConfigFile(fileService: any, config: any) {
    try {
      const path = require('path');
      const fse = require('fs-extra');
      const configPath = path.join(fileService.baseDir, '.vscode', 'sftp.json');
      
      // Read the current config file to preserve formatting and comments
      const currentConfig = await fse.readJson(configPath);
      
      // Update only the remoteExplorer section
      currentConfig.remoteExplorer = config.remoteExplorer;
      
      // Write back to file
      await fse.writeJson(configPath, currentConfig, { spaces: 2 });
      
      vscode.window.showInformationMessage('Column visibility updated in config');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update config: ${error.message}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 0;
      overflow: hidden;
    }

    #tree-container {
      width: 100%;
      height: 100vh;
      overflow: auto;
    }

    .tree-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }

    .tree-table thead {
      position: sticky;
      top: 0;
      background-color: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      z-index: 10;
    }

    .tree-table th {
      text-align: left;
      padding: 4px 8px;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-sideBarSectionHeader-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      position: relative;
      user-select: none;
    }

    .tree-table th .resize-handle {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 5px;
      cursor: col-resize;
      user-select: none;
    }

    .tree-table th .resize-handle:hover {
      background-color: var(--vscode-focusBorder);
    }

    .tree-table th:first-child {
      min-width: 200px;
    }

    .tree-table th:not(:first-child) {
      min-width: 80px;
    }

    .tree-row {
      cursor: pointer;
      border-bottom: 1px solid transparent;
    }

    .tree-row:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .tree-row.selected {
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .tree-row td {
      padding: 2px 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 13px;
    }

    .tree-cell-name {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .tree-indent {
      display: inline-block;
    }

    .tree-expander {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      cursor: pointer;
      user-select: none;
    }

    .tree-expander.collapsed::before {
      content: "▶";
      font-size: 10px;
    }

    .tree-expander.expanded::before {
      content: "▼";
      font-size: 10px;
    }

    .tree-expander.leaf {
      visibility: hidden;
    }

    .tree-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      margin-right: 4px;
      font-size: 16px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    /* Folder icon */
    .folder-icon::before {
      content: "📁";
    }

    /* Programming language icons with colors */
    .js-icon::before { content: "JS"; font-size: 10px; font-weight: bold; color: #f7df1e; }
    .jsx-icon::before { content: "JSX"; font-size: 9px; font-weight: bold; color: #61dafb; }
    .ts-icon::before { content: "TS"; font-size: 10px; font-weight: bold; color: #3178c6; }
    .tsx-icon::before { content: "TSX"; font-size: 9px; font-weight: bold; color: #3178c6; }
    .python-icon::before { content: "PY"; font-size: 10px; font-weight: bold; color: #3776ab; }
    .java-icon::before { content: "☕"; }
    .php-icon::before { content: "PHP"; font-size: 9px; font-weight: bold; color: #777bb4; }
    .ruby-icon::before { content: "RB"; font-size: 10px; font-weight: bold; color: #cc342d; }
    .go-icon::before { content: "GO"; font-size: 10px; font-weight: bold; color: #00add8; }
    .rust-icon::before { content: "RS"; font-size: 10px; font-weight: bold; color: #dea584; }
    .swift-icon::before { content: "SW"; font-size: 10px; font-weight: bold; color: #f05138; }
    .c-icon::before { content: "C"; font-size: 11px; font-weight: bold; color: #555555; }
    .cpp-icon::before { content: "C++"; font-size: 8px; font-weight: bold; color: #00599c; }
    .csharp-icon::before { content: "C#"; font-size: 10px; font-weight: bold; color: #239120; }
    .kotlin-icon::before { content: "KT"; font-size: 10px; font-weight: bold; color: #7f52ff; }

    /* Web files */
    .html-icon::before { content: "HTML"; font-size: 8px; font-weight: bold; color: #e34c26; }
    .css-icon::before { content: "CSS"; font-size: 9px; font-weight: bold; color: #1572b6; }
    .scss-icon::before { content: "SCSS"; font-size: 8px; font-weight: bold; color: #cc6699; }
    .sass-icon::before { content: "SASS"; font-size: 8px; font-weight: bold; color: #cc6699; }
    .less-icon::before { content: "LESS"; font-size: 8px; font-weight: bold; color: #1d365d; }

    /* Data/Config files */
    .json-icon::before { content: "{}"; font-size: 12px; color: #cbcb41; }
    .xml-icon::before { content: "<>"; font-size: 12px; color: #e37933; }
    .yaml-icon::before { content: "YML"; font-size: 9px; font-weight: bold; color: #cb171e; }
    .toml-icon::before { content: "TOML"; font-size: 8px; font-weight: bold; color: #9c4221; }
    .ini-icon::before { content: "INI"; font-size: 9px; font-weight: bold; color: #6d8086; }
    .config-icon::before { content: "⚙"; color: #6d8086; }
    .env-icon::before { content: "ENV"; font-size: 9px; font-weight: bold; color: #faf047; }

    /* Documentation */
    .markdown-icon::before { content: "MD"; font-size: 10px; font-weight: bold; color: #519aba; }
    .text-icon::before { content: "TXT"; font-size: 9px; font-weight: bold; color: #89d185; }
    .pdf-icon::before { content: "PDF"; font-size: 9px; font-weight: bold; color: #f40f02; }
    .word-icon::before { content: "DOC"; font-size: 9px; font-weight: bold; color: #2b579a; }
    .readme-icon::before { content: "📖"; }

    /* Images */
    .image-icon::before { content: "🖼"; }
    .svg-icon::before { content: "SVG"; font-size: 9px; font-weight: bold; color: #ffb13b; }

    /* Archives */
    .archive-icon::before { content: "📦"; }

    /* Special files */
    .git-icon::before { content: "GIT"; font-size: 9px; font-weight: bold; color: #f05032; }
    .docker-icon::before { content: "🐳"; }
    .npm-icon::before { content: "NPM"; font-size: 9px; font-weight: bold; color: #cb3837; }
    .tsconfig-icon::before { content: "TS⚙"; font-size: 10px; color: #3178c6; }
    .webpack-icon::before { content: "WP"; font-size: 10px; font-weight: bold; color: #8dd6f9; }
    .database-icon::before { content: "🗄"; }
    .shell-icon::before { content: "SH"; font-size: 10px; font-weight: bold; color: #89e051; }

    /* Default file */
    .default-file-icon::before { content: "📄"; }

    .tree-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tree-row.root {
      font-weight: 600;
    }

    .tree-row.hidden {
      display: none;
    }

    .metadata-cell {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .size-cell {
      text-align: right;
    }

    .loading {
      padding: 8px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .column-hidden {
      display: none !important;
    }

    .context-menu {
      position: fixed;
      background-color: var(--vscode-menu-background);
      border: 1px solid var(--vscode-menu-border);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      z-index: 1000;
      min-width: 200px;
    }

    .context-menu-item {
      padding: 6px 20px 6px 30px;
      cursor: pointer;
      color: var(--vscode-menu-foreground);
      position: relative;
      user-select: none;
    }

    .context-menu-item:hover {
      background-color: var(--vscode-menu-selectionBackground);
      color: var(--vscode-menu-selectionForeground);
    }

    .context-menu-item.checked::before {
      content: "✓";
      position: absolute;
      left: 8px;
      font-weight: bold;
    }

    .context-menu-separator {
      height: 1px;
      background-color: var(--vscode-menu-separatorBackground);
      margin: 4px 0;
    }
  </style>
</head>
<body>
  <div id="tree-container">
    <table class="tree-table">
      <thead>
        <tr id="header-row">
          <th><span>Name</span><div class="resize-handle"></div></th>
          <th class="col-size"><span>Size</span><div class="resize-handle"></div></th>
          <th class="col-permissions"><span>Permissions</span><div class="resize-handle"></div></th>
          <th class="col-owner"><span>Owner</span><div class="resize-handle"></div></th>
          <th class="col-modified"><span>Modified</span><div class="resize-handle"></div></th>
        </tr>
      </thead>
      <tbody id="tree-body">
        <tr>
          <td colspan="5" class="loading">Loading...</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div id="context-menu" class="context-menu" style="display: none;">
    <!-- File Commands -->
    <div class="context-menu-section" id="file-commands">
      <div class="context-menu-item" data-command="sftp.remoteExplorer.editInLocal">Edit in Local</div>
      <div class="context-menu-item" data-command="sftp.viewContent">View Content</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.download.file">Download</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.rename.file">Rename</div>
      <div class="context-menu-item" data-command="sftp.remoteExplorer.copyFile">Copy</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.remote.chmod">Change Permissions</div>
      <div class="context-menu-item" data-command="sftp.remote.chown">Change Owner</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.delete.remote">Delete</div>
    </div>
    
    <!-- Folder Commands -->
    <div class="context-menu-section" id="folder-commands" style="display: none;">
      <div class="context-menu-item" data-command="sftp.create.file">New File</div>
      <div class="context-menu-item" data-command="sftp.create.folder">New Folder</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.download.folder">Download</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.rename.folder">Rename</div>
      <div class="context-menu-item" data-command="sftp.remoteExplorer.copyFolder">Copy</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.remote.chmod">Change Permissions</div>
      <div class="context-menu-item" data-command="sftp.remote.chown">Change Owner</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-command="sftp.delete.remote">Delete</div>
    </div>
    
    <!-- Paste Commands (shown when something is copied) -->
    <div class="context-menu-section" id="paste-commands" style="display: none;">
      <div class="context-menu-item" data-command="paste">Paste</div>
      <div class="context-menu-separator"></div>
    </div>
    
    <div class="context-menu-separator"></div>
    
    <!-- Column Visibility -->
    <div class="context-menu-section">
      <div class="context-menu-item" data-column="showSize">Show Size</div>
      <div class="context-menu-item" data-column="showPermissions">Show Permissions</div>
      <div class="context-menu-item" data-column="showOwner">Show Owner</div>
      <div class="context-menu-item" data-column="showModified">Show Modified</div>
    </div>
    
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-command="sftp.remoteExplorer.refresh">Refresh</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let treeData = [];
    let expandedNodes = new Set();
    let selectedNode = null;
    let copiedItem = null; // Track copied file/folder
    let columnVisibility = {
      showSize: true,
      showPermissions: false,
      showOwner: false,
      showModified: true
    };

    // Listen for messages from the extension
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'update':
          treeData = message.data;
          if (message.expandedNodes) {
            expandedNodes = new Set(message.expandedNodes);
          }
          if (message.columnVisibility) {
            columnVisibility = message.columnVisibility;
          }
          updateColumnVisibility();
          renderTree();
          break;
      }
    });

    // Context menu handling
    const contextMenu = document.getElementById('context-menu');
    let contextMenuNodeId = null;
    let contextMenuIsDirectory = false;
    
    document.getElementById('tree-container').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      
      // Find the clicked row
      const row = e.target.closest('.tree-row');
      if (row) {
        contextMenuNodeId = row.dataset.nodeId;
        contextMenuIsDirectory = row.dataset.isDirectory === 'true';
      } else {
        contextMenuNodeId = null;
        contextMenuIsDirectory = false;
      }
      
      showContextMenu(e.clientX, e.clientY);
    });

    document.addEventListener('click', () => {
      hideContextMenu();
    });

    document.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const column = item.getAttribute('data-column');
        const command = item.getAttribute('data-command');
        
        if (column) {
          toggleColumn(column);
        } else if (command) {
          executeCommand(command);
        }
        
        hideContextMenu();
      });
    });

    function showContextMenu(x, y) {
      // Show/hide appropriate command sections
      const fileCommands = document.getElementById('file-commands');
      const folderCommands = document.getElementById('folder-commands');
      const pasteCommands = document.getElementById('paste-commands');
      
      if (contextMenuNodeId) {
        if (contextMenuIsDirectory) {
          fileCommands.style.display = 'none';
          folderCommands.style.display = 'block';
        } else {
          fileCommands.style.display = 'block';
          folderCommands.style.display = 'none';
        }
      } else {
        fileCommands.style.display = 'none';
        folderCommands.style.display = 'none';
      }
      
      // Show paste option if something is copied and we're on a folder
      if (copiedItem && contextMenuIsDirectory) {
        pasteCommands.style.display = 'block';
      } else {
        pasteCommands.style.display = 'none';
      }
      
      updateContextMenuChecks();
      contextMenu.style.display = 'block';
      contextMenu.style.left = x + 'px';
      contextMenu.style.top = y + 'px';
    }

    function hideContextMenu() {
      contextMenu.style.display = 'none';
    }

    function updateContextMenuChecks() {
      document.querySelectorAll('.context-menu-item').forEach(item => {
        const column = item.getAttribute('data-column');
        if (column && columnVisibility[column]) {
          item.classList.add('checked');
        } else {
          item.classList.remove('checked');
        }
      });
    }

    function toggleColumn(column) {
      vscode.postMessage({
        type: 'toggleColumn',
        column: column
      });
    }

    function executeCommand(command) {
      // Handle copy commands specially
      if (command === 'sftp.remoteExplorer.copyFile' || command === 'sftp.remoteExplorer.copyFolder') {
        copiedItem = {
          nodeId: contextMenuNodeId,
          isDirectory: contextMenuIsDirectory,
          command: command
        };
        vscode.postMessage({
          type: 'executeCommand',
          command: command,
          nodeId: contextMenuNodeId
        });
        return;
      }
      
      // Handle paste command specially
      if (command === 'paste') {
        if (!copiedItem) {
          return;
        }
        // Use the appropriate paste command based on what was copied
        const pasteCommand = copiedItem.isDirectory ? 
          'sftp.remoteExplorer.pasteFolder' : 
          'sftp.remoteExplorer.pasteFile';
        
        vscode.postMessage({
          type: 'executeCommand',
          command: pasteCommand,
          nodeId: contextMenuNodeId // Paste into the current folder
        });
        copiedItem = null; // Clear after paste
        return;
      }
      
      if (!contextMenuNodeId) {
        // Execute command without node (e.g., refresh)
        vscode.postMessage({
          type: 'executeCommand',
          command: command,
          nodeId: null
        });
        return;
      }
      
      vscode.postMessage({
        type: 'executeCommand',
        command: command,
        nodeId: contextMenuNodeId
      });
    }

    function updateColumnVisibility() {
      // Update header columns
      const headers = document.querySelectorAll('#header-row th');
      headers[1].classList.toggle('column-hidden', !columnVisibility.showSize);
      headers[2].classList.toggle('column-hidden', !columnVisibility.showPermissions);
      headers[3].classList.toggle('column-hidden', !columnVisibility.showOwner);
      headers[4].classList.toggle('column-hidden', !columnVisibility.showModified);
    }

    function getFileIconClass(filename, ext) {
      // Map extensions to icon classes that match common file icon themes
      const iconMap = {
        // JavaScript/TypeScript
        'js': 'js-icon',
        'jsx': 'jsx-icon',
        'ts': 'ts-icon',
        'tsx': 'tsx-icon',
        'mjs': 'js-icon',
        'cjs': 'js-icon',
        
        // Web
        'html': 'html-icon',
        'htm': 'html-icon',
        'css': 'css-icon',
        'scss': 'scss-icon',
        'sass': 'sass-icon',
        'less': 'less-icon',
        
        // Python
        'py': 'python-icon',
        'pyc': 'python-icon',
        'pyd': 'python-icon',
        'pyo': 'python-icon',
        'pyw': 'python-icon',
        
        // Java/JVM
        'java': 'java-icon',
        'class': 'java-icon',
        'jar': 'jar-icon',
        'kt': 'kotlin-icon',
        'kts': 'kotlin-icon',
        
        // C/C++
        'c': 'c-icon',
        'cpp': 'cpp-icon',
        'cc': 'cpp-icon',
        'cxx': 'cpp-icon',
        'h': 'h-icon',
        'hpp': 'hpp-icon',
        
        // C#
        'cs': 'csharp-icon',
        'csx': 'csharp-icon',
        
        // PHP
        'php': 'php-icon',
        'phtml': 'php-icon',
        
        // Ruby
        'rb': 'ruby-icon',
        'erb': 'ruby-icon',
        
        // Go
        'go': 'go-icon',
        
        // Rust
        'rs': 'rust-icon',
        
        // Swift
        'swift': 'swift-icon',
        
        // Shell
        'sh': 'shell-icon',
        'bash': 'shell-icon',
        'zsh': 'shell-icon',
        'fish': 'shell-icon',
        
        // Data/Config
        'json': 'json-icon',
        'jsonc': 'json-icon',
        'xml': 'xml-icon',
        'yaml': 'yaml-icon',
        'yml': 'yaml-icon',
        'toml': 'toml-icon',
        'ini': 'ini-icon',
        'conf': 'config-icon',
        'config': 'config-icon',
        'env': 'env-icon',
        
        // Markdown/Docs
        'md': 'markdown-icon',
        'markdown': 'markdown-icon',
        'txt': 'text-icon',
        'pdf': 'pdf-icon',
        'doc': 'word-icon',
        'docx': 'word-icon',
        
        // Images
        'png': 'image-icon',
        'jpg': 'image-icon',
        'jpeg': 'image-icon',
        'gif': 'image-icon',
        'bmp': 'image-icon',
        'svg': 'svg-icon',
        'ico': 'image-icon',
        'webp': 'image-icon',
        'tiff': 'image-icon',
        'tif': 'image-icon',
        
        // Archives
        'zip': 'archive-icon',
        'tar': 'archive-icon',
        'gz': 'archive-icon',
        'rar': 'archive-icon',
        '7z': 'archive-icon',
        'bz2': 'archive-icon',
        
        // Git
        'gitignore': 'git-icon',
        'gitattributes': 'git-icon',
        'gitmodules': 'git-icon',
        
        // Docker
        'dockerfile': 'docker-icon',
        
        // Database
        'sql': 'database-icon',
        'db': 'database-icon',
        'sqlite': 'database-icon',
      };
      
      // Check for special filenames
      const lowerFilename = filename.toLowerCase();
      if (lowerFilename === 'package.json') return 'npm-icon';
      if (lowerFilename === 'package-lock.json') return 'npm-icon';
      if (lowerFilename === 'tsconfig.json') return 'tsconfig-icon';
      if (lowerFilename === 'webpack.config.js') return 'webpack-icon';
      if (lowerFilename === 'dockerfile') return 'docker-icon';
      if (lowerFilename === '.gitignore') return 'git-icon';
      if (lowerFilename === 'readme.md') return 'readme-icon';
      
      return iconMap[ext] || 'default-file-icon';
    }

    // Column resizing
    let resizingColumn = null;
    let startX = 0;
    let startWidth = 0;

    document.querySelectorAll('.resize-handle').forEach((handle, index) => {
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        resizingColumn = e.target.parentElement;
        startX = e.clientX;
        startWidth = resizingColumn.offsetWidth;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });

    function onMouseMove(e) {
      if (resizingColumn) {
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        resizingColumn.style.width = newWidth + 'px';
      }
    }

    function onMouseUp() {
      resizingColumn = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    function formatFileSize(bytes) {
      if (!bytes || bytes === 0) return '';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDate(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }

    function formatPermissions(mode, isDirectory) {
      if (mode === undefined || mode === null) return '';
      
      const typeChar = isDirectory ? 'd' : '-';
      const symbols = ['r', 'w', 'x'];
      const segments = [mode >> 6, mode >> 3, mode]
        .map(segment => segment & 0b111)
        .map(value =>
          symbols
            .map((symbol, index) => (value & (1 << (2 - index)) ? symbol : '-'))
            .join('')
        );

      return typeChar + segments.join('');
    }

    function formatOwner(owner, group) {
      const ownerPart = owner ? owner.trim() : '';
      const groupPart = group ? group.trim() : '';

      if (ownerPart && groupPart) {
        return \`\${ownerPart}:\${groupPart}\`;
      }

      return ownerPart || groupPart || '';
    }

    function toggleExpand(nodeId) {
      // Request toggle from extension
      vscode.postMessage({
        type: 'expand',
        nodeId: nodeId
      });
    }

    function selectNode(nodeId) {
      selectedNode = nodeId;
      renderTree();
    }

    function openFile(nodeId) {
      vscode.postMessage({
        type: 'openFile',
        nodeId: nodeId
      });
    }

    function renderTree() {
      const tbody = document.getElementById('tree-body');
      tbody.innerHTML = '';

      if (treeData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">No items</td></tr>';
        return;
      }

      treeData.forEach((item, index) => {
        const row = document.createElement('tr');
        row.className = 'tree-row';
        row.dataset.nodeId = item.id;
        row.dataset.isDirectory = item.isDirectory;
        
        if (item.isRoot) {
          row.classList.add('root');
        }
        if (selectedNode === item.id) {
          row.classList.add('selected');
        }

        // Name column
        const nameCell = document.createElement('td');
        nameCell.className = 'tree-cell-name';
        
        // Add indentation based on level
        const indent = document.createElement('span');
        indent.style.display = 'inline-block';
        indent.style.width = (item.level * 16) + 'px';
        nameCell.appendChild(indent);
        
        const expander = document.createElement('span');
        expander.className = 'tree-expander';
        if (item.isDirectory) {
          expander.className += expandedNodes.has(item.id) ? ' expanded' : ' collapsed';
          expander.onclick = (e) => {
            e.stopPropagation();
            toggleExpand(item.id);
          };
        } else {
          expander.className += ' leaf';
        }
        nameCell.appendChild(expander);

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        
        // Use VS Code's file association to determine icon class
        if (item.isDirectory) {
          icon.className += ' file-icon folder-icon';
        } else {
          const ext = item.name.includes('.') ? item.name.split('.').pop().toLowerCase() : '';
          const iconClass = getFileIconClass(item.name, ext);
          icon.className += ' file-icon ' + iconClass;
        }
        
        nameCell.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = item.name;
        nameCell.appendChild(label);

        row.appendChild(nameCell);

        // Size column
        const sizeCell = document.createElement('td');
        sizeCell.className = 'metadata-cell size-cell col-size';
        if (!columnVisibility.showSize) {
          sizeCell.classList.add('column-hidden');
        }
        sizeCell.textContent = item.metadata.size ? formatFileSize(item.metadata.size) : '';
        row.appendChild(sizeCell);

        // Permissions column
        const permCell = document.createElement('td');
        permCell.className = 'metadata-cell col-permissions';
        if (!columnVisibility.showPermissions) {
          permCell.classList.add('column-hidden');
        }
        permCell.textContent = formatPermissions(item.metadata.mode, item.isDirectory);
        row.appendChild(permCell);

        // Owner column
        const ownerCell = document.createElement('td');
        ownerCell.className = 'metadata-cell col-owner';
        if (!columnVisibility.showOwner) {
          ownerCell.classList.add('column-hidden');
        }
        ownerCell.textContent = formatOwner(item.metadata.owner, item.metadata.group);
        row.appendChild(ownerCell);

        // Modified column
        const modifiedCell = document.createElement('td');
        modifiedCell.className = 'metadata-cell col-modified';
        if (!columnVisibility.showModified) {
          modifiedCell.classList.add('column-hidden');
        }
        modifiedCell.textContent = formatDate(item.metadata.mtime);
        row.appendChild(modifiedCell);

        row.onclick = () => {
          selectNode(item.id);
          if (!item.isDirectory) {
            openFile(item.id);
          } else {
            toggleExpand(item.id);
          }
        };

        tbody.appendChild(row);
      });
    }

    // Request initial data
    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
