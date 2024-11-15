import { fileOperations } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import { showErrorMessage } from '../host';
import logger from '../logger';

export const remoteChmod = createFileHandler<FileHandleOption & { mode: string }>({
  name: 'remotechmod',
  async handle({ mode }) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    await remoteFs.chmod(this.target.remoteFsPath, mode).then((val) => {
      logger.debug(`Success, permissions ${mode}`);
    }).catch((err) => {
      showErrorMessage(err);
    });
  },
});

export const getRemoteChmod = createFileHandler({
  name: "getRemoteChmod",
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    //const localFs = this.fileService.getLocalFileSystem();
    const { remoteFsPath } = this.target;
    await fileOperations.lstat(remoteFsPath, remoteFs);

  }
});

export const remoteChown = createFileHandler<FileHandleOption & { arg: string }>({
  name: 'remotechown',
  async handle({ arg }) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    await remoteFs.chown(this.target.remoteFsPath, arg).then((val) => {
      logger.debug(`Success, owner ${arg}`);
    }).catch((err) => {
      showErrorMessage(err);
    });
  },
});

export const getRemoteChown = createFileHandler({
  name: "getRemoteChown",
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    //const localFs = this.fileService.getLocalFileSystem();
    const { remoteFsPath } = this.target;
    await fileOperations.lstat(remoteFsPath, remoteFs);

  }
});