import { COMMAND_COPY_FOLDER } from '../constants';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';
import { copyRemoteFolder } from '../fileHandlers/shared';

export default checkFileCommand({
  id: COMMAND_COPY_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await copyRemoteFolder(ctx.target);
  },
});
