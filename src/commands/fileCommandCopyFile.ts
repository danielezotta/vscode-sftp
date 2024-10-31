import { COMMAND_COPY_FILE } from '../constants';
// import { copyFile } from '../fileHandlers';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { log } from 'console';
import { copyRemoteFile } from '../fileHandlers/shared';

export default checkFileCommand({
  id: COMMAND_COPY_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    log('copy file', ctx);
    await copyRemoteFile(ctx.target);
    // await downloadFile(ctx, { ignore: null });
  },
});
