import { COMMAND_REMOTE_CHOWN } from '../constants';
import { checkFileCommand } from './abstract/createCommand';
import { Uri, window } from 'vscode';
import { remoteChown } from '../fileHandlers/chmod';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { handleCtxFromUri } from '../fileHandlers';

export default checkFileCommand({
  id: COMMAND_REMOTE_CHOWN,
  options: {
    mode: "root:root"
  },
  async getFileTarget(item, items) {
    let targets = uriFromExplorerContextOrEditorContext(item, items);

    if (!targets) {
      return;
    }
    if (Array.isArray(targets)) {
      if (targets.length < 1) {
        return;
      }
      targets = targets.shift();
    }
    if (!(targets instanceof Uri)) {
      return;
    }
    const ctx = handleCtxFromUri(targets);
    const config = ctx.config;
    const remoteFs = await ctx.fileService.getRemoteFileSystem(config);
    await remoteFs.lstat(targets.fsPath).then((value) => {
      this.options.mode = value.owner + ":" + value.group;
    }).catch((err) => {
      console.log(err)
    });
    const result = await window.showInputBox({
      value: this.options.mode.toString(8),
      prompt: 'Please input permissions',
      validateInput: function (val: string) {
        if (val.length > 0 && val.match(/^(.*):(.*)$/g)) {
          return null;
        }
        return "Invalid value";
      }
    });

    if (result !== undefined) {
      this.options.mode = result;
      return targets;
    }
    return undefined;
  },
  async handleFile(ctx) {
    if (!this.options.mode) {
      return;
    }
    await remoteChown(ctx, { arg: this.options.mode });
  }
});
