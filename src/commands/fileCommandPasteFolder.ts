import { COMMAND_PASTE_FOLDER } from '../constants';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { pasteRemoteFolder } from '../fileHandlers/shared';
import { commands } from 'vscode';

export default checkFileCommand({
  id: COMMAND_PASTE_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await pasteRemoteFolder(ctx);
    commands.executeCommand('setContext', 'sftp.copiedFolderShowCommand', false);
  },
});
