import { COMMAND_PASTE_FILE } from '../constants';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { pasteRemoteFile } from '../fileHandlers/shared';
import { commands } from 'vscode';

export default checkFileCommand({
  id: COMMAND_PASTE_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await pasteRemoteFile(ctx);
    commands.executeCommand('setContext', 'sftp.copiedFileShowCommand', false);
  },
});
