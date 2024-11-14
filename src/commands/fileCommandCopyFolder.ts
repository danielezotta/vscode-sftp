import { COMMAND_COPY_FOLDER } from '../constants';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { copyRemoteFolder } from '../fileHandlers/shared';
import { commands } from 'vscode';

export default checkFileCommand({
  id: COMMAND_COPY_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await copyRemoteFolder(ctx.target);
    commands.executeCommand('setContext', 'sftp.copiedFolderShowCommand', true);
  },
});
