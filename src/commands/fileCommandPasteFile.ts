import { COMMAND_PASTE_FILE } from '../constants';
// import { copyFile } from '../fileHandlers';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { log } from 'console';
import { pasteRemoteFile } from '../fileHandlers/shared';

export default checkFileCommand({
  id: COMMAND_PASTE_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await pasteRemoteFile(ctx);
  },
});
