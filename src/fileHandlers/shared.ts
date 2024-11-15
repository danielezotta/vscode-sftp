import { UResource, FileService, FileType, LocalFileSystem } from '../core';
import app from '../app';
import { log } from 'console';
import { Uri, window } from 'vscode';
import * as path from 'path';
import { FileHandlerContext } from './createFileHandler';
import { downloadFile, downloadFolder, uploadFile, uploadFolder } from './transfer';
import logger from '../logger';

// NEED_VSCODE_UPDATE: detect explorer view visible
// refresh will open explorer view which cause a problem https://github.com/liximomo/vscode-sftp/issues/286
// export function refreshLocalExplorer(localUri: Uri) {
//   // do nothing
// }

var copiedFile : UResource | null = null;
var copiedFolder : UResource | null = null;

export async function refreshRemoteExplorer(target: UResource, isDirectory: FileService | boolean) {
  if (isDirectory instanceof FileService) {
    const fileService = isDirectory;
    const localFs = fileService.getLocalFileSystem();
    const fileEntry = await localFs.lstat(target.localFsPath);
    isDirectory = fileEntry.type === FileType.Directory;
  }

  app.remoteExplorer.refresh({
    resource: UResource.makeResource(target.remoteUri),
    isDirectory,
  });
}

export async function copyRemoteFile(target: UResource) {
  copiedFile = target;
}

export async function pasteRemoteFile(ctx: FileHandlerContext) {
  if (copiedFile == null) { return; }

  try {
    const fileName = path.basename(copiedFile.localFsPath);

    const localFs = ctx.fileService.getLocalFileSystem();
    const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);

    const newLocalFilePath = ctx.target.localFsPath.toString() + localFs.pathResolver.sep + fileName;
    const newRemoteFilePath = ctx.target.remoteFsPath.toString() + remoteFs.pathResolver.sep + fileName;

    try {
      await remoteFs.lstat(newRemoteFilePath);
      logger.warn(`Can't paste file because already exist`);
      window.showErrorMessage(`Can't paste file because already exist`);
      return;
    } catch (error) {
  
    }

    await downloadFile(copiedFile.remoteUri, { ignore: null });    

    const stream = await localFs.get(copiedFile.localFsPath, { encoding: 'utf8' });

    await localFs.ensureDir(localFs.pathResolver.dirname(newLocalFilePath));

    await localFs.put(stream, newLocalFilePath);

    // Upload the downloaded file to the remote FS
    await uploadFile(Uri.file(newLocalFilePath), { ignore: null });
    
    copiedFile = null;

    refreshRemoteExplorer(ctx.target, false);

  } catch (error) {
    log('Error pasting file:', error);
    window.showErrorMessage(`Failed to paste file. Error: ${error.message}`);
  }

}

export async function copyRemoteFolder(target: UResource) {
  copiedFolder = target;
}

export async function pasteRemoteFolder(ctx: FileHandlerContext) {
  if (copiedFolder == null) { return; }

  try {
    const localFs = ctx.fileService.getLocalFileSystem();
    const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);

    const folderName = path.basename(copiedFolder.localFsPath);
    
    const newLocalFolderPath = ctx.target.localFsPath.toString() + localFs.pathResolver.sep + folderName + localFs.pathResolver.sep;
    const newRemoteFolderPath = ctx.target.remoteFsPath.toString() + remoteFs.pathResolver.sep + folderName + remoteFs.pathResolver.sep;

    try {
      await remoteFs.lstat(newRemoteFolderPath);
      logger.warn(`Can't paste folder because already exist`);
      window.showErrorMessage(`Can't paste folder because already exist`);
      return;
    } catch (error) {
  
    }

    await downloadFolder(copiedFolder.remoteUri, { ignore: null });

    // Create the destination directory if it doesn't exist
    await localFs.ensureDir(newLocalFolderPath);

    await (localFs as LocalFileSystem).copy(copiedFolder.localFsPath, newLocalFolderPath);

    await uploadFolder(Uri.file(newLocalFolderPath), { ignore: null });

    refreshRemoteExplorer(ctx.target, false);

  } catch (error) {
    log('Error pasting folder:', error);
    window.showErrorMessage(error.message);
  }
}