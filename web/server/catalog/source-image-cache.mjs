import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../localdb/db.mjs';
import { taskPath, taskDirectory } from '../collect/task-paths.mjs';
import { inspectImage } from '../collect/domestic-detail.mjs';
export const SOURCE_IMAGE_TYPES=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'});
const directory=join(REPO_ROOT,'.tmp/catalog-images');
export function cacheSourceImage(id,validation){
 if(!/^[a-f0-9]{32,64}$/.test(id)||!validation?.ok||!Buffer.isBuffer(validation.bytes)||!SOURCE_IMAGE_TYPES[validation.mime])throw new Error('INVALID_VALIDATED_IMAGE');
 inspectImage(validation.bytes,validation.mime);
 const path=taskPath(join(taskDirectory(directory),`${id}.${SOURCE_IMAGE_TYPES[validation.mime]}`));
 writeFileSync(path,validation.bytes);return path;
}
export function readSourceImage(id){
 if(!/^[a-f0-9]{32,64}$/.test(id))return null;
 for(const [type,extension]of Object.entries(SOURCE_IMAGE_TYPES)){
  const path=taskPath(join(directory,`${id}.${extension}`));if(!existsSync(path))continue;
  const bytes=readFileSync(path);const dimensions=inspectImage(bytes,type);return{bytes,type,...dimensions};
 }return null;
}
