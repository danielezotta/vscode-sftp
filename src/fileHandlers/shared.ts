import { UResource, FileService, FileType, FileSystem, LocalFileSystem } from '../core';
import app from '../app';
import { log } from 'console';
import { Uri, window } from 'vscode';
import * as path from 'path';
import { FileHandlerContext } from './createFileHandler';
import { downloadFile, downloadFolder, uploadFile, uploadFolder } from './transfer';

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

function splitNameAndExtension(fileName: string) {
  const ext = path.extname(fileName);
  const baseName = ext ? fileName.slice(0, -ext.length) : fileName;
  return { baseName, extension: ext };
}

async function existsInLocal(localFs: FileSystem, fullPath: string): Promise<boolean> {
  try {
    await localFs.lstat(fullPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function existsInRemote(remoteFs: FileSystem, fullPath: string): Promise<boolean> {
  try {
    await remoteFs.lstat(fullPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function getAvailableCopyName(
  localFs: FileSystem,
  remoteFs: FileSystem,
  localBaseDir: string,
  remoteBaseDir: string,
  baseName: string,
  extension: string,
): Promise<string> {
  let attempt = 0;

  while (true) {
    let candidateName: string;
    if (attempt === 0) {
      candidateName = `${baseName}${extension}`;
    } else if (attempt === 1) {
      candidateName = `${baseName}_copy${extension}`;
    } else {
      candidateName = `${baseName}_copy_${attempt}${extension}`;
    }

    const localCandidatePath = localFs.pathResolver.join(localBaseDir, candidateName);
    const remoteCandidatePath = remoteFs.pathResolver.join(remoteBaseDir, candidateName);

    const [localExists, remoteExists] = await Promise.all([
      existsInLocal(localFs, localCandidatePath),
      existsInRemote(remoteFs, remoteCandidatePath),
    ]);

    if (!localExists && !remoteExists) {
      return candidateName;
    }

    attempt += 1;
  }
}

export async function copyRemoteFile(target: UResource) {
  copiedFile = target;
}

export async function pasteRemoteFile(ctx: FileHandlerContext) {
  if (copiedFile == null) { return; }

  try {
    const localFs = ctx.fileService.getLocalFileSystem();
    const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);

    const originalFileName = path.basename(copiedFile.localFsPath);
    const { baseName, extension } = splitNameAndExtension(originalFileName);

    const localBaseDir = ctx.target.localFsPath.toString();
    const remoteBaseDir = ctx.target.remoteFsPath.toString();

    const fileName = await getAvailableCopyName(
      localFs,
      remoteFs,
      localBaseDir,
      remoteBaseDir,
      baseName,
      extension
    );

    const newLocalFilePath = localFs.pathResolver.join(localBaseDir, fileName);

    await downloadFile(copiedFile.remoteUri, { ignore: null });    

    // Read file without encoding to preserve binary data (images, etc.)
    const stream = await localFs.get(copiedFile.localFsPath);

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

    const originalFolderName = path.basename(copiedFolder.localFsPath);
    const { baseName } = splitNameAndExtension(originalFolderName);

    const localBaseDir = ctx.target.localFsPath.toString();
    const remoteBaseDir = ctx.target.remoteFsPath.toString();

    const folderName = await getAvailableCopyName(
      localFs,
      remoteFs,
      localBaseDir,
      remoteBaseDir,
      baseName,
      ''
    );

    const newLocalFolderPath = localFs.pathResolver.join(localBaseDir, folderName);

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