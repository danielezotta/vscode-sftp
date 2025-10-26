import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../constants';
import { downloadFile } from '../fileHandlers';
import { executeCommand } from '../host';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await downloadFile(ctx, { ignore: null });
    await executeCommand('vscode.open', ctx.target.localUri, { preview: true });
  },
});
