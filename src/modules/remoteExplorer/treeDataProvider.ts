import * as vscode from 'vscode';
import {
  upath,
  UResource,
  Resource,
  FileService,
  FileType,
  FileEntry,
  Ignore,
  ServiceConfig,
} from '../../core';
import {
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
} from '../../constants';
import { getAllFileService } from '../serviceManager';

type Id = number;

const previewDocumentPathPrefix = '/~ ';

const DEFAULT_FILES_EXCLUDE = ['.git', '.svn', '.hg', 'CVS', '.DS_Store'];

/**
 * covert the url path for a customed docuemnt title
 *
 *  There is no api to custom title.
 *  So we change url path for custom title.
 *  This is not break anything because we get fspth from uri.query.'
 */
function makePreivewUrl(uri: vscode.Uri) {
  // const query = querystring.parse(uri.query);
  // query.originPath = uri.path;
  // query.originQuery = uri.query;

  return uri.with({
    path: previewDocumentPathPrefix + upath.basename(uri.path),
    // query: querystring.stringify(query),
  });
}

interface ExplorerChild {
  resource: Resource;
  isDirectory: boolean;
}

export interface ExplorerRoot extends ExplorerChild {
  explorerContext: {
    fileService: FileService;
    config: ServiceConfig;
    id: Id;
  };
}

export type ExplorerItem = ExplorerRoot | ExplorerChild;

function dirFirstSort(fileA: ExplorerItem, fileB: ExplorerItem) {
  if (fileA.isDirectory === fileB.isDirectory) {
    return fileA.resource.fsPath.localeCompare(fileB.resource.fsPath);
  }

  return fileA.isDirectory ? -1 : 1;
}

export default class RemoteTreeData
  implements vscode.TreeDataProvider<ExplorerItem>, vscode.TextDocumentContentProvider {
  private _roots: ExplorerRoot[] | null;
  private _rootsMap: Map<Id, ExplorerRoot> | null;
  private _map: Map<vscode.Uri['query'], ExplorerItem>;

  private _onDidChangeFolder: vscode.EventEmitter<ExplorerItem | null> = new vscode.EventEmitter<
    ExplorerItem | null
  >();
  private _onDidChangeFile: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeTreeData: vscode.Event<ExplorerItem | null | undefined> = this._onDidChangeFolder.event;
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChangeFile.event;

  async refresh(item?: ExplorerItem): Promise<any> {
    // refresh root
    if (!item) {
      // clear cache
      this._roots = null;
      this._rootsMap = null;

      this._onDidChangeFolder.fire(null);
      return;
    }

    if (item.isDirectory) {
      this._onDidChangeFolder.fire(item);

      // refresh top level files as well
      const children = await this.getChildren(item);
      children
        .filter(i => !i.isDirectory)
        .forEach(i => this._onDidChangeFile.fire(makePreivewUrl(i.resource.uri)));
    } else {
      const parent = await this.getParent(item);
      if (parent) {
        this._onDidChangeFolder.fire(parent);
      }
      this._onDidChangeFile.fire(makePreivewUrl(item.resource.uri));
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatDate(timestamp: number): string {
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

  private formatPermissions(mode: number | undefined, isDirectory: boolean): string {
    if (mode === undefined || mode === null) {
      return '';
    }

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

  private formatOwner(owner?: string, group?: string): string {
    const ownerPart = owner ? owner.trim() : '';
    const groupPart = group ? group.trim() : '';

    if (ownerPart && groupPart) {
      return `${ownerPart}:${groupPart}`;
    }

    return ownerPart || groupPart || '';
  }

  getTreeItem(item: ExplorerItem): vscode.TreeItem {
    const isRoot = (item as ExplorerRoot).explorerContext !== undefined;
    let label = ''; // Initialize with empty string
    const treeItem = new vscode.TreeItem(
      '', // We'll set the label after processing
      item.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    
    if (isRoot) {
      label = (item as ExplorerRoot).explorerContext.fileService.name;
    } else {
      const fileName = upath.basename(item.resource.fsPath);
      const fileEntry = this._map?.get(item.resource.uri.query) as (FileEntry & { mtime?: number }) | undefined;
      const root = this.findRoot(item.resource.uri);
      const explorerSettings = root?.explorerContext.config.remoteExplorer ?? ({} as ServiceConfig['remoteExplorer']);
      const showOwner = explorerSettings?.showOwner ?? false;
      const showPermissions = explorerSettings?.showPermissions ?? false;
      const showSize = explorerSettings?.showSize ?? true;
      const showModified = explorerSettings?.showModified ?? true;
      
      if (fileEntry) {
        const lastModified = 'mtime' in fileEntry ? fileEntry.mtime : 0;
        const dateStr = this.formatDate(lastModified);
        const metaParts: string[] = [];

        if (!item.isDirectory && showSize) {
          const size = 'size' in fileEntry ? fileEntry.size : 0;
          metaParts.push(this.formatFileSize(size));
        }

        if (showPermissions) {
          const permissions = this.formatPermissions(fileEntry.mode, item.isDirectory);
          if (permissions) {
            metaParts.push(permissions);
          }
        }

        if (showOwner) {
          const ownerStr = this.formatOwner((fileEntry as any).owner, (fileEntry as any).group);
          if (ownerStr) {
            metaParts.push(ownerStr);
          }
        }

        if (showModified && dateStr) {
          metaParts.push(dateStr);
        }

        // Pad filename to align columns across all files in the directory
        const maxLen = (item as any).__maxNameLen as number | undefined;
        if (maxLen && maxLen > fileName.length) {
          label = fileName.padEnd(maxLen, ' ');
        } else {
          label = fileName;
        }

        // Build description with metadata columns using visual separators
        if (metaParts.length) {
          const columns: string[] = [];
          const separator = ' │ '; // Unicode box-drawing character for visual separation

          // Size column (right-aligned for better readability)
          if (showSize) {
            const sizeVal = !item.isDirectory && 'size' in fileEntry ? this.formatFileSize((fileEntry as any).size || 0) : '';
            columns.push(sizeVal.padStart(10, ' '));
          }

          // Permissions column
          if (showPermissions) {
            const permVal = this.formatPermissions(fileEntry.mode, item.isDirectory) || '';
            columns.push(permVal.padEnd(10, ' '));
          }

          // Owner column
          if (showOwner) {
            const ownerVal = this.formatOwner((fileEntry as any).owner, (fileEntry as any).group) || '';
            columns.push(ownerVal.padEnd(15, ' '));
          }

          // Date column
          if (showModified) {
            const dateVal = dateStr || '';
            columns.push(dateVal);
          }

          // Join columns with visual separator
          treeItem.description = columns.join(separator);
        }
      }
    }
    
    treeItem.label = label;
    // Description is already set above with the metadata
    
    treeItem.resourceUri = item.resource.uri;
    treeItem.contextValue = isRoot ? 'root' : item.isDirectory ? 'folder' : 'file';
    if (!isRoot && !item.isDirectory) {
      // Always use editInLocal to open files in editable mode
      treeItem.command = {
        command: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
        arguments: [item],
        title: 'Edit Remote File',
      };
    }
    
    return treeItem;
  }

  async getChildren(item?: ExplorerItem): Promise<ExplorerItem[]> {
    if (!item) {
      return this._getRoots();
    }

    const root = this.findRoot(item.resource.uri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${item.resource.uri}.`);
    }
    const config = root.explorerContext.config;
    const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);
    const fileEntries = await remotefs.list(item.resource.fsPath);

    const filesExcludeList: string[] =
      config.remoteExplorer && config.remoteExplorer.filesExclude
        ? config.remoteExplorer.filesExclude.concat(DEFAULT_FILES_EXCLUDE)
        : DEFAULT_FILES_EXCLUDE;

    const ignore = new Ignore(filesExcludeList);
    function filterFile(file: FileEntry) {
      const relativePath = upath.relative(config.remotePath, file.fspath);
      return !ignore.ignores(relativePath);
    }

    const result = fileEntries
      .filter(filterFile)
      .map(file => {
        const isDirectory = file.type === FileType.Directory;
        const newResource = UResource.updateResource(item.resource, {
          remotePath: file.fspath,
        });
        const mapItem = this._map.get(newResource.uri.query);
        if (mapItem) {
          // Update the existing map item with the latest file info
          if ('size' in file) {
            (mapItem as any).size = file.size;
          }
          return mapItem as any;
        } else {
          const newItem = {
            resource: UResource.updateResource(item.resource, {
              remotePath: file.fspath,
            }),
            isDirectory,
            // Store the file entry details including size
            ...file,
          };
          this._map.set(newItem.resource.uri.query, newItem);
          return newItem as any;
        }
      })
      .sort(dirFirstSort);

    // Compute max filename length among siblings and assign to each item
    if (result.length) {
      const maxLen = result.reduce((m, i) => {
        const name = upath.basename(i.resource.fsPath);
        return Math.max(m, name.length);
      }, 0);
      for (const i of result) {
        (i as any).__maxNameLen = maxLen;
      }
    }

    return result;
  }

  async getParent(item: ExplorerChild): Promise<ExplorerItem> {
    const resourceUri = item.resource.uri;
    const root = this.findRoot(resourceUri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${resourceUri}.`);
    }

    if (item.resource.fsPath === root.resource.fsPath) {
      return root;
    }

    const fspath = upath.dirname(item.resource.fsPath);
    const newResource = UResource.updateResource(item.resource, {
      remotePath: fspath,
    });
    const mapItem = this._map.get(newResource.uri.query);
    if (mapItem) {
      return mapItem;
    } else {
      const newMapItem = {
        resource: newResource,
        isDirectory: true,
      };
      this._map.set(newResource.uri.query, newMapItem);
      await this.getChildren(newMapItem);
      return newMapItem;
    }
  }

  findRoot(uri: vscode.Uri): ExplorerRoot | null | undefined {
    if (!this._rootsMap) {
      return null;
    }

    const rootId = UResource.makeResource(uri).remoteId;
    return this._rootsMap.get(rootId);
  }

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string> {
    const root = this.findRoot(uri);
    if (!root) {
      throw new Error(`Can't find remote for resource ${uri}.`);
    }

    const config = root.explorerContext.config;
    const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);
    const buffer = await remotefs.readFile(UResource.makeResource(uri).fsPath);
    return buffer.toString();
  }

  showItem(item: ExplorerItem): void {
    if (item.isDirectory) {
      return;
    }

    // Always use editInLocal to download and open files in editable mode
    import('vscode').then(vscode => {
      vscode.commands.executeCommand(COMMAND_REMOTEEXPLORER_EDITINLOCAL, item);
    });
  }

  private _getRoots(): ExplorerRoot[] {
    if (this._roots) {
      return this._roots;
    }

    this._roots = [];
    this._rootsMap = new Map();
    this._map = new Map();
    getAllFileService().forEach(fileService => {
      const config = fileService.getConfig();
      const id = fileService.id;
      const item = {
        resource: UResource.makeResource({
          remote: {
            host: config.host,
            port: config.port,
          },
          fsPath: config.remotePath,
          remoteId: id,
        }),
        isDirectory: true,
        explorerContext: {
          fileService,
          config,
          id,
        },
      };
      this._roots!.push(item);
      this._rootsMap!.set(id, item);
      this._map.set(item.resource.uri.query, item);
    });
    this._roots.sort((a,b) => a.explorerContext.config.remoteExplorer.order - b.explorerContext.config.remoteExplorer.order || a.explorerContext.fileService.name.localeCompare(b.explorerContext.fileService.name));
    return this._roots;
  }
}
