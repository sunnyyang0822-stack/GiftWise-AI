// 仅读栅格文件头尺寸，不执行SVG/HTML，不把供应商size字段当图像字节证据。
export function inspectRaster(bytes) {
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>16000000)throw new Error('IMAGE_BYTES_INVALID');
 let width,height,type,extension;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);type='image/png';extension='png';
 }else if(bytes[0]===255&&bytes[1]===216){
  let offset=2;
  while(offset+4<bytes.length){if(bytes[offset]!==255)break;const marker=bytes[offset+1];if(marker===217||marker===218)break;const length=bytes.readUInt16BE(offset+2);if(length<2||offset+2+length>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=bytes.readUInt16BE(offset+5);width=bytes.readUInt16BE(offset+7);break;}offset+=length+2;
  }type='image/jpeg';extension='jpg';
 }
 if(!width||!height||width>8192||height>8192||width*height>20000000)throw new Error('IMAGE_DIMENSIONS_INVALID');
 return {width,height,type,extension};
}
