import { COMMAND_COPY_FILE } from '../constants';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { copyRemoteFile } from '../fileHandlers/shared';
import { commands } from 'vscode'

export default checkFileCommand({
  id: COMMAND_COPY_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await copyRemoteFile(ctx.target);
    commands.executeCommand('setContext', 'sftp.copiedFileShowCommand', true);
  },
});
