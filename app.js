let imageQueue = [];
let imageStates = []; 
let currentIdx = 0;

let currentImage = null; 
let previewImage = null; 
let previewScale = 1; 

let applyMode = 'individual'; 
let currentZoom = 1;
let isDragging = false;
let startX, startY;
let translateX = 0, translateY = 0;

let isCropMode = false;
let isCreatingCrop = false;
let draggingCropPoint = -1;
let cropCreateStart = {x:0, y:0};
let tempCropPts = null; 
let isEyedropperMode = false; 

let exportZipName = "BatchExport";

const globalPreviewOutCanvas = document.createElement('canvas');

// DEFAULT STATE (restored color channels)
const defaultState = { deskewAngle: 0, brightness: 100, contrast: 100, saturation: 100, hue: 0, exposure: 0, temp: 0, tint: 0, sharpen: 0, cropPts: null, croppedCanvas: null, wbMultR: 1, wbMultG: 1, wbMultB: 1, wbAmount: 100, redChan: 0, greenChan: 0, blueChan: 0, pixelMathCanvas: null };

const fileInput = document.getElementById('fileInput');
const importBtn = document.getElementById('importBtn');
const folderInput = document.getElementById('folderInput');
const importFolderBtn = document.getElementById('importFolderBtn');
const thumbnailStrip = document.getElementById('thumbnail-strip');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const notification = document.getElementById('notification');
const progressText = document.getElementById('batchProgress');

const zoomReadout = document.getElementById('zoomReadout');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');

const resizeWidth = document.getElementById('resizeWidth');
const resizeHeight = document.getElementById('resizeHeight');
const autoWidth = document.getElementById('autoWidth');
const autoHeight = document.getElementById('autoHeight');
const noResize = document.getElementById('noResize');
const widthRow = document.getElementById('widthRow');
const heightRow = document.getElementById('heightRow');

let renderRequested = false;
let renderOverrideState = null;
let renderForceCropView = false;

function requestRender(overrideState = null, forceCropView = false) {
  renderOverrideState = overrideState;
  renderForceCropView = forceCropView;
  if (!renderRequested) {
    renderRequested = true;
    requestAnimationFrame(() => {
      drawImage(renderOverrideState, renderForceCropView);
      renderRequested = false;
    });
  }
}

function syncResizeUI() {
  const isNoResize = noResize.checked;
  
  widthRow.style.opacity = isNoResize ? '0.4' : '1';
  heightRow.style.opacity = isNoResize ? '0.4' : '1';
  
  autoWidth.disabled = isNoResize;
  autoHeight.disabled = isNoResize;
  
  resizeWidth.disabled = isNoResize || autoWidth.checked;
  resizeHeight.disabled = isNoResize || autoHeight.checked;
  
  resizeWidth.parentElement.style.background = resizeWidth.disabled ? 'transparent' : 'var(--bg-card)';
  resizeHeight.parentElement.style.background = resizeHeight.disabled ? 'transparent' : 'var(--bg-card)';
}

noResize.addEventListener('change', syncResizeUI);
autoWidth.addEventListener('change', (e) => {
  if (e.target.checked && autoHeight.checked) autoHeight.checked = false;
  syncResizeUI();
});
autoHeight.addEventListener('change', (e) => {
  if (e.target.checked && autoWidth.checked) autoWidth.checked = false;
  syncResizeUI();
});

syncResizeUI();

importBtn.addEventListener('click', () => fileInput.click());
importFolderBtn.addEventListener('click', () => folderInput.click());

fileInput.addEventListener('change', (e) => {
  handleFileInput(e);
  e.target.value = ''; 
});
folderInput.addEventListener('change', (e) => {
  handleFileInput(e);
  e.target.value = ''; 
});

function handleFileInput(e) {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return showToast("No image files found.");
  
  if (e.target.files.length > 0 && e.target.files[0].webkitRelativePath) {
     const pathParts = e.target.files[0].webkitRelativePath.split('/');
     exportZipName = pathParts[0] || "BatchExport";
  } else {
     exportZipName = "BatchExport";
  }
  
  processLoadedFiles(files);
}

function handleDragOver(e) { 
  e.preventDefault(); e.stopPropagation(); 
  e.currentTarget.classList.add('drag-over'); 
}
function handleDragLeave(e) { 
  e.preventDefault(); e.stopPropagation(); 
  e.currentTarget.classList.remove('drag-over'); 
}

importBtn.addEventListener('dragover', handleDragOver);
importBtn.addEventListener('dragleave', handleDragLeave);
importBtn.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation();
  importBtn.classList.remove('drag-over');
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    exportZipName = "BatchExport";
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return showToast("No image files found.");
    processLoadedFiles(files);
  }
});

importFolderBtn.addEventListener('dragover', handleDragOver);
importFolderBtn.addEventListener('dragleave', handleDragLeave);
importFolderBtn.addEventListener('drop', async (e) => {
  e.preventDefault(); e.stopPropagation();
  importFolderBtn.classList.remove('drag-over');
  
  let items = e.dataTransfer.items;
  if (!items) return;
  
  let files = [];
  let folderName = "BatchExport";
  
  showToast("Scanning folder...");
  
  for (let i = 0; i < items.length; i++) {
      let item = items[i].webkitGetAsEntry();
      if (item) {
          if (item.isDirectory && folderName === "BatchExport") {
            folderName = item.name;
          }
          await traverseFileTree(item, files);
      }
  }
  
  const validFiles = files.filter(f => f.type.startsWith('image/'));
  if (!validFiles.length) return showToast("No image files found in folder.");
  
  exportZipName = folderName;
  processLoadedFiles(validFiles);
});

function traverseFileTree(item, files) {
  return new Promise((resolve) => {
      if (item.isFile) {
          item.file((file) => { files.push(file); resolve(); });
      } else if (item.isDirectory) {
          let dirReader = item.createReader();
          let readAllEntries = () => {
              dirReader.readEntries(async (entries) => {
                  if (entries.length === 0) {
                      resolve();
                  } else {
                      let promises = [];
                      for (let i = 0; i < entries.length; i++) {
                          promises.push(traverseFileTree(entries[i], files));
                      }
                      await Promise.all(promises);
                      readAllEntries(); 
                  }
              });
          };
          readAllEntries();
      } else {
          resolve();
      }
  });
}

function processLoadedFiles(files) {
  imageQueue = files;
  imageStates = files.map(() => ({ ...defaultState }));
  currentIdx = 0;
  buildThumbnails();
  loadActiveFile();
  showToast("Files loaded successfully.");
}

function showToast(message) {
  notification.innerText = message;
  notification.style.display = 'block';
  setTimeout(() => { notification.style.display = 'none'; }, 2500);
}

function removeImage(index) {
  imageQueue.splice(index, 1);
  imageStates.splice(index, 1);
  
  if (imageQueue.length === 0) {
    currentImage = null; previewImage = null; currentIdx = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    thumbnailStrip.innerHTML = '';
    progressText.innerText = "No images loaded";
    exportZipName = "BatchExport";
    showToast("Queue is empty.");
    return;
  }
  
  if (index < currentIdx) currentIdx--;
  else if (index === currentIdx && currentIdx >= imageQueue.length) currentIdx = imageQueue.length - 1;
  
  buildThumbnails();
  loadActiveFile();
}

async function buildThumbnails() {
  thumbnailStrip.innerHTML = '';
  
  for (let i = 0; i < imageQueue.length; i++) {
    const div = document.createElement('div');
    div.className = 'thumb-box' + (i === currentIdx ? ' active' : '');
    div.id = `thumb-${i}`;
    
    div.addEventListener('click', () => {
      if (i === currentIdx) return;
      document.querySelectorAll('.thumb-box').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
      currentIdx = i;
      loadActiveFile();
    });
    thumbnailStrip.appendChild(div);
  }

  for (let i = 0; i < imageQueue.length; i++) {
    const thumbURL = await generateMiniThumb(imageQueue[i]);
    const div = document.getElementById(`thumb-${i}`);
    if (div) {
      div.innerHTML = ''; 
      
      const img = document.createElement('img');
      img.src = thumbURL;
      
      const removeBtn = document.createElement('div');
      removeBtn.className = 'thumb-remove';
      removeBtn.title = "Remove";
      removeBtn.innerText = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeImage(i);
      });
      
      div.appendChild(img);
      div.appendChild(removeBtn);
    }
  }
}

function generateMiniThumb(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const pCan = document.createElement('canvas');
      const size = 120;
      const scale = Math.min(size / img.width, size / img.height);
      pCan.width = img.width * scale;
      pCan.height = img.height * scale;
      pCan.getContext('2d').drawImage(img, 0, 0, pCan.width, pCan.height);
      URL.revokeObjectURL(url);
      resolve(pCan.toDataURL('image/webp', 0.6));
    };
    img.src = url;
  });
}

function loadActiveFile() {
  if (currentIdx >= imageQueue.length) return;
  
  imageStates.forEach((s, i) => { 
    if (i !== currentIdx) { s.croppedCanvas = null; s.pixelMathCanvas = null; } 
  });

  const file = imageQueue[currentIdx];
  const url = URL.createObjectURL(file);
  
  currentImage = new Image();
  currentImage.onload = () => {
    const maxDim = 1200; 
    let w = currentImage.width, h = currentImage.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) { h = Math.round((maxDim / w) * h); w = maxDim; }
      else { w = Math.round((maxDim / h) * w); h = maxDim; }
    }
    previewScale = currentImage.width / w;
    
    const pCan = document.createElement('canvas');
    pCan.width = w; pCan.height = h;
    pCan.getContext('2d', { willReadFrequently: true }).drawImage(currentImage, 0, 0, w, h);
    
    previewImage = new Image();
    previewImage.onload = () => {
      progressText.innerText = `Image ${currentIdx + 1} of ${imageQueue.length} — ${file.name}`;
      syncUIWithState(); resetView(); requestRender();
      URL.revokeObjectURL(url); 
    };
    previewImage.src = pCan.toDataURL('image/webp', 0.9);
  };
  currentImage.src = url;
}

document.getElementById('modeIndividualBtn').addEventListener('click', (e) => {
  applyMode = 'individual'; 
  e.target.classList.add('active-btn');
  document.getElementById('modeAllBtn').classList.remove('active-btn');
  showToast("Applying adjustments to this image only.");
});

document.getElementById('modeAllBtn').addEventListener('click', (e) => {
  applyMode = 'all'; 
  e.target.classList.add('active-btn');
  document.getElementById('modeIndividualBtn').classList.remove('active-btn');
  
  const currentState = { ...imageStates[currentIdx] };
  imageStates = imageStates.map(() => ({ ...currentState }));
  showToast("State synchronized across all images.");
});


function applyPixelMath(sourceImg, state, cacheCanvas) {
  // Check if any color channel manipulation is active
  if (state.wbAmount === 0 && state.sharpen === 0 && state.redChan === 0 && state.greenChan === 0 && state.blueChan === 0) return sourceImg; 
  
  let out = cacheCanvas;
  if (!out) out = document.createElement('canvas');
  if (out.width !== sourceImg.width) out.width = sourceImg.width;
  if (out.height !== sourceImg.height) out.height = sourceImg.height;

  const tCtx = out.getContext('2d', { willReadFrequently: true });
  tCtx.drawImage(sourceImg, 0, 0);
  const imgData = tCtx.getImageData(0,0,out.width,out.height);
  const data = imgData.data;
  
  const w = out.width;
  const h = out.height;
  const wbA = state.wbAmount / 100;
  const shA = state.sharpen / 100;
  
  const rOff = state.redChan;
  const gOff = state.greenChan;
  const bOff = state.blueChan;

  if (shA > 0) {
    const center = 1 + 4 * shA;
    const edge = -shA;
    const finalData = new Uint8ClampedArray(data); 
    
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        
        for (let c = 0; c < 3; c++) {
           let val = data[i+c] * center +
                     data[i - w*4 + c] * edge +
                     data[i + w*4 + c] * edge +
                     data[i - 4 + c] * edge +
                     data[i + 4 + c] * edge;
           
           if (wbA > 0) {
              const mult = c === 0 ? state.wbMultR : c === 1 ? state.wbMultG : state.wbMultB;
              const target = Math.min(255, val * mult);
              val = val + (target - val) * wbA;
           }
           
           const chanOff = c === 0 ? rOff : c === 1 ? gOff : bOff;
           finalData[i+c] = val + chanOff;
        }
      }
    }
    
    if (wbA > 0 || rOff !== 0 || gOff !== 0 || bOff !== 0) {
       for (let x = 0; x < w; x++) {
          let iTop = x * 4;
          let iBot = ((h-1)*w + x) * 4;
          for(let c=0; c<3; c++) {
             const mult = c === 0 ? state.wbMultR : c === 1 ? state.wbMultG : state.wbMultB;
             const chanOff = c === 0 ? rOff : c === 1 ? gOff : bOff;
             finalData[iTop+c] = data[iTop+c] + (Math.min(255, data[iTop+c] * mult) - data[iTop+c]) * wbA + chanOff;
             finalData[iBot+c] = data[iBot+c] + (Math.min(255, data[iBot+c] * mult) - data[iBot+c]) * wbA + chanOff;
          }
       }
       for (let y = 1; y < h-1; y++) {
          let iLft = y * w * 4;
          let iRgt = (y * w + w - 1) * 4;
          for(let c=0; c<3; c++) {
             const mult = c === 0 ? state.wbMultR : c === 1 ? state.wbMultG : state.wbMultB;
             const chanOff = c === 0 ? rOff : c === 1 ? gOff : bOff;
             finalData[iLft+c] = data[iLft+c] + (Math.min(255, data[iLft+c] * mult) - data[iLft+c]) * wbA + chanOff;
             finalData[iRgt+c] = data[iRgt+c] + (Math.min(255, data[iRgt+c] * mult) - data[iRgt+c]) * wbA + chanOff;
          }
       }
    }
    imgData.data.set(finalData);
  } else {
    for(let i=0; i<data.length; i+=4){
      const origR = data[i], origG = data[i+1], origB = data[i+2];
      data[i]   = origR + (Math.min(255, origR * state.wbMultR) - origR) * wbA + rOff;
      data[i+1] = origG + (Math.min(255, origG * state.wbMultG) - origG) * wbA + gOff;
      data[i+2] = origB + (Math.min(255, origB * state.wbMultB) - origB) * wbA + bOff;
    }
  }

  tCtx.putImageData(imgData, 0, 0);
  return out;
}

document.getElementById('awbBtn').addEventListener('click', () => {
  if (!previewImage) return;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 400; tempCanvas.height = Math.round(previewImage.height * (400 / previewImage.width));
  const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  tCtx.drawImage(previewImage, 0, 0, tempCanvas.width, tempCanvas.height);
  const data = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
  
  let r=0, g=0, b=0, count=0;
  for(let i=0; i<data.length; i+=4) { r += data[i]; g += data[i+1]; b += data[i+2]; count++; }
  const avgGray = ((r/count) + (g/count) + (b/count)) / 3;

  const mR = avgGray / (r/count); const mG = avgGray / (g/count); const mB = avgGray / (b/count);

  if (applyMode === 'all') {
    imageStates.forEach(s => { s.wbMultR = mR; s.wbMultG = mG; s.wbMultB = mB; s.pixelMathCanvas = null; });
  } else {
    imageStates[currentIdx].wbMultR = mR; imageStates[currentIdx].wbMultG = mG; imageStates[currentIdx].wbMultB = mB; imageStates[currentIdx].pixelMathCanvas = null;
  }
  requestRender();
  showToast("Auto White Balance calculated.");
});

const eyedropperBtn = document.getElementById('eyedropperBtn');
eyedropperBtn.addEventListener('click', () => {
  if(!previewImage) return;
  isEyedropperMode = !isEyedropperMode;
  
  if (isEyedropperMode) {
    eyedropperBtn.classList.add('active-btn');
    eyedropperBtn.innerText = 'Select Area...';
    canvasContainer.style.cursor = 'crosshair';
    isCropMode = false;
  } else {
    eyedropperBtn.classList.remove('active-btn');
    eyedropperBtn.innerText = 'Pick White';
    canvasContainer.style.cursor = 'grab';
  }
});

document.getElementById('resetWbBtn').addEventListener('click', () => {
  if (!previewImage) return;
  if (applyMode === 'all') {
    imageStates.forEach(state => { 
      state.wbMultR = 1; state.wbMultG = 1; state.wbMultB = 1; state.wbAmount = 100; 
      state.pixelMathCanvas = null; 
    });
  } else {
    const state = imageStates[currentIdx];
    state.wbMultR = 1; state.wbMultG = 1; state.wbMultB = 1; state.wbAmount = 100; 
    state.pixelMathCanvas = null;
  }
  syncUIWithState(); requestRender(); showToast("White Balance reset.");
});


const cropBtn = document.getElementById('cropBtn');
const clearCropBtn = document.getElementById('clearCropBtn');

function extractPerspectiveCrop(img, pts, cacheCanvas) {
    const topW = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const botW = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
    const lftH = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
    const rgtH = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
    const outW = Math.round(Math.max(topW, botW));
    const outH = Math.round(Math.max(lftH, rgtH));
    if(outW <= 0 || outH <= 0) return img;

    let outCanvas = cacheCanvas;
    if (!outCanvas) outCanvas = document.createElement('canvas');
    if (outCanvas.width !== outW) outCanvas.width = outW;
    if (outCanvas.height !== outH) outCanvas.height = outH;

    const oCtx = outCanvas.getContext('2d');
    const origCanvas = document.createElement('canvas');
    origCanvas.width = img.width; origCanvas.height = img.height;
    origCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
    
    const srcData = origCanvas.getContext('2d').getImageData(0,0,img.width,img.height).data;
    const outImgData = oCtx.createImageData(outW, outH);
    const outData = outImgData.data;

    for(let y = 0; y < outH; y++) {
        const v = y / outH;
        for(let x = 0; x < outW; x++) {
            const u = x / outW;
            const srcX = (1-v) * ((1-u)*pts[0].x + u*pts[1].x) + v * ((1-u)*pts[3].x + u*pts[2].x);
            const srcY = (1-v) * ((1-u)*pts[0].y + u*pts[1].y) + v * ((1-u)*pts[3].y + u*pts[2].y);
            const sx = Math.floor(srcX); const sy = Math.floor(srcY);
            if (sx >= 0 && sx < img.width && sy >= 0 && sy < img.height) {
                const outIdx = (y * outW + x) * 4;
                const srcIdx = (sy * img.width + sx) * 4;
                outData[outIdx] = srcData[srcIdx]; outData[outIdx+1] = srcData[srcIdx+1];
                outData[outIdx+2] = srcData[srcIdx+2]; outData[outIdx+3] = srcData[srcIdx+3];
            }
        }
    }
    oCtx.putImageData(outImgData, 0, 0);
    return outCanvas;
}

cropBtn.addEventListener('click', () => {
  if (!previewImage) return;
  if (!isCropMode) {
    isCropMode = true; tempCropPts = null; 
    cropBtn.classList.add('active-btn');
    cropBtn.innerText = 'Apply Crop'; 
    canvasContainer.style.cursor = 'crosshair'; 
    resetView(); requestRender(null, true);
    
    isEyedropperMode = false;
    eyedropperBtn.classList.remove('active-btn');
    eyedropperBtn.innerText = 'Pick White';
  } else {
    if (tempCropPts) {
      const savedPts = tempCropPts.map(p => ({x: p.x, y: p.y}));
      if (applyMode === 'all') {
        imageStates.forEach(state => { state.cropPts = savedPts; state.croppedCanvas = null; state.pixelMathCanvas = null; });
      } else {
        imageStates[currentIdx].cropPts = savedPts; imageStates[currentIdx].croppedCanvas = null; imageStates[currentIdx].pixelMathCanvas = null;
      }
      showToast("Perspective crop applied.");
    }
    isCropMode = false; tempCropPts = null;
    cropBtn.classList.remove('active-btn');
    cropBtn.innerText = 'Perspective Crop'; 
    canvasContainer.style.cursor = 'grab'; 
    syncUIWithState(); requestRender();
  }
});

clearCropBtn.addEventListener('click', () => {
  isCropMode = false; tempCropPts = null;
  cropBtn.classList.remove('active-btn');
  cropBtn.innerText = 'Perspective Crop';
  canvasContainer.style.cursor = 'grab';
  if (applyMode === 'all') {
    imageStates.forEach(s => { s.cropPts = null; s.croppedCanvas = null; s.pixelMathCanvas = null; });
  } else {
    imageStates[currentIdx].cropPts = null; imageStates[currentIdx].croppedCanvas = null; imageStates[currentIdx].pixelMathCanvas = null;
  }
  syncUIWithState(); requestRender(); showToast("Crop cleared.");
});


function applyTransform() { canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`; zoomReadout.innerText = `${Math.round(currentZoom * 100)}%`; }
function updateZoom(newZoom) { currentZoom = Math.max(0.1, Math.min(newZoom, 15)); applyTransform(); }
function resetView() { currentZoom = 1; translateX = 0; translateY = 0; applyTransform(); }
zoomInBtn.addEventListener('click', () => updateZoom(currentZoom + 0.25));
zoomOutBtn.addEventListener('click', () => updateZoom(currentZoom - 0.25));
zoomResetBtn.addEventListener('click', resetView);
canvasContainer.addEventListener('wheel', (e) => {
  e.preventDefault(); const zoomStep = currentZoom * 0.1; 
  if (e.deltaY < 0) updateZoom(currentZoom + zoomStep); else updateZoom(currentZoom - zoomStep);
}, { passive: false });

canvasContainer.addEventListener('mousedown', (e) => {
  if (isEyedropperMode) {
     const rect = canvas.getBoundingClientRect();
     const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
     const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
     
     const size = 5;
     const half = Math.floor(size / 2);
     const startX = Math.max(0, Math.min(canvas.width - size, x - half));
     const startY = Math.max(0, Math.min(canvas.height - size, y - half));
     
     const pixels = ctx.getImageData(startX, startY, size, size).data;
     let rSum = 0, gSum = 0, bSum = 0, count = 0;
     
     for (let i = 0; i < pixels.length; i += 4) {
        rSum += pixels[i];
        gSum += pixels[i+1];
        bSum += pixels[i+2];
        count++;
     }
     
     const avgR = rSum / count;
     const avgG = gSum / count;
     const avgB = bSum / count;
     
     if (avgR > 10 && avgG > 10 && avgB > 10) { 
        // 240 true-white targeting algorithm restored
        const mR = Math.min(5, 240 / avgR); 
        const mG = Math.min(5, 240 / avgG); 
        const mB = Math.min(5, 240 / avgB);
        
        if (applyMode === 'all') {
          imageStates.forEach(s => { s.wbMultR = mR; s.wbMultG = mG; s.wbMultB = mB; s.pixelMathCanvas = null; });
        } else {
          imageStates[currentIdx].wbMultR = mR; imageStates[currentIdx].wbMultG = mG; imageStates[currentIdx].wbMultB = mB; imageStates[currentIdx].pixelMathCanvas = null;
        }
        showToast("White point defined (5x5 avg).");
     } else {
        showToast("Target too dark for calibration.");
     }
     
     isEyedropperMode = false; 
     eyedropperBtn.classList.remove('active-btn'); eyedropperBtn.innerText = 'Pick White'; 
     canvasContainer.style.cursor = 'grab';
     requestRender();
     return;
  }

  if (isCropMode) {
    const rect = canvas.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const imgY = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (tempCropPts) draggingCropPoint = tempCropPts.findIndex(p => Math.hypot(p.x - imgX, p.y - imgY) < 30);
    if (draggingCropPoint === -1) {
      isCreatingCrop = true; cropCreateStart = {x: imgX, y: imgY};
      tempCropPts = [ {x:imgX, y:imgY}, {x:imgX, y:imgY}, {x:imgX, y:imgY}, {x:imgX, y:imgY} ];
    }
  } else if (currentZoom > 1) { 
    isDragging = true; canvasContainer.style.cursor = 'grabbing';
    startX = e.clientX - translateX; startY = e.clientY - translateY;
  }
});

window.addEventListener('mousemove', (e) => {
  if (isCropMode && (isCreatingCrop || draggingCropPoint !== -1)) {
    const rect = canvas.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const imgY = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (isCreatingCrop) {
      const minX = Math.min(cropCreateStart.x, imgX); const maxX = Math.max(cropCreateStart.x, imgX);
      const minY = Math.min(cropCreateStart.y, imgY); const maxY = Math.max(cropCreateStart.y, imgY);
      tempCropPts[0] = {x: minX, y: minY}; tempCropPts[1] = {x: maxX, y: minY};
      tempCropPts[2] = {x: maxX, y: maxY}; tempCropPts[3] = {x: minX, y: maxY};
    } else {
      tempCropPts[draggingCropPoint] = {x: imgX, y: imgY};
    }
    requestRender(null, true); 
  } else if (isDragging) {
    translateX = e.clientX - startX; translateY = e.clientY - startY; applyTransform();
  }
});

window.addEventListener('mouseup', () => { 
  if (isCropMode) { isCreatingCrop = false; draggingCropPoint = -1; if (tempCropPts) requestRender(null, true); }
  isDragging = false; 
  if(!isCropMode && !isEyedropperMode) canvasContainer.style.cursor = 'grab';
});

function syncUIWithState() {
  const state = imageStates[currentIdx];
  const setVal = (id, valId, val) => { const el = document.getElementById(id); if(el) { el.value = val; document.getElementById(valId).innerText = val; }};
  
  setVal('deskewRange', 'deskewVal', state.deskewAngle); 
  setVal('brightness', 'brightVal', state.brightness); setVal('contrast', 'contrastVal', state.contrast);
  setVal('saturation', 'satVal', state.saturation); setVal('hue', 'hueVal', state.hue);
  setVal('exposure', 'expVal', state.exposure); setVal('temp', 'tempVal', state.temp); setVal('tint', 'tintVal', state.tint);
  
  setVal('sharpen', 'sharpenVal', state.sharpen);
  setVal('wbAmountRange', 'wbAmountVal', state.wbAmount); 
  
  // Sync the color channel sliders
  setVal('redChanRange', 'redChanVal', state.redChan);
  setVal('greenChanRange', 'greenChanVal', state.greenChan);
  setVal('blueChanRange', 'blueChanVal', state.blueChan);
  
  clearCropBtn.style.display = state.cropPts ? 'block' : 'none';
  
  if(isEyedropperMode) {
    isEyedropperMode = false; eyedropperBtn.classList.remove('active-btn'); eyedropperBtn.innerText = 'Pick White'; canvasContainer.style.cursor = 'grab';
  }
}

const bindInput = (id, valId, stateKey) => {
  const inputEl = document.getElementById(id); if (!inputEl) return;
  inputEl.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value); document.getElementById(valId).innerText = val;
    if (applyMode === 'all') {
      imageStates.forEach(state => {
        state[stateKey] = val;
        if (stateKey === 'wbAmount' || stateKey === 'sharpen' || stateKey === 'redChan' || stateKey === 'greenChan' || stateKey === 'blueChan') {
            state.pixelMathCanvas = null;
        }
      });
    } else {
      imageStates[currentIdx][stateKey] = val; 
      if (stateKey === 'wbAmount' || stateKey === 'sharpen' || stateKey === 'redChan' || stateKey === 'greenChan' || stateKey === 'blueChan') {
          imageStates[currentIdx].pixelMathCanvas = null;
      }
    }
    requestRender();
  });
};

bindInput('deskewRange', 'deskewVal', 'deskewAngle'); 
bindInput('brightness', 'brightVal', 'brightness'); bindInput('contrast', 'contrastVal', 'contrast');
bindInput('saturation', 'satVal', 'saturation'); bindInput('hue', 'hueVal', 'hue');
bindInput('exposure', 'expVal', 'exposure'); bindInput('temp', 'tempVal', 'temp'); bindInput('tint', 'tintVal', 'tint');
bindInput('sharpen', 'sharpenVal', 'sharpen');
bindInput('wbAmountRange', 'wbAmountVal', 'wbAmount');

// Bind RGB channel sliders
bindInput('redChanRange', 'redChanVal', 'redChan');
bindInput('greenChanRange', 'greenChanVal', 'greenChan');
bindInput('blueChanRange', 'blueChanVal', 'blueChan');

document.getElementById('quality').addEventListener('input', (e) => {
  document.getElementById('qualityVal').innerText = e.target.value;
});

document.querySelectorAll('input[name="format"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const isPNG = e.target.value === 'image/png';
    const qBox = document.getElementById('qualityBox');
    if (qBox) {
        qBox.style.opacity = isPNG ? '0.4' : '1';
        document.getElementById('quality').disabled = isPNG;
    }
  });
});

document.getElementById('deskewBtn').addEventListener('click', () => {
  if (!previewImage) return;
  const analWidth = 400; const analHeight = Math.round(previewImage.height * (analWidth / previewImage.width));
  const tempCanvas = document.createElement('canvas'); tempCanvas.width = analWidth; tempCanvas.height = analHeight;
  const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true }); tCtx.drawImage(previewImage, 0, 0, analWidth, analHeight);
  const data = tCtx.getImageData(0, 0, analWidth, analHeight).data;

  let optimalAngle = 0; let highestVariance = 0;
  for (let angle = -12; angle <= 12; angle += 0.4) {
    const radians = (angle * Math.PI) / 180; const bins = new Array(analHeight).fill(0);
    for (let y = 0; y < analHeight; y += 4) {
      for (let x = 0; x < analWidth; x += 4) {
        const offset = (y * analWidth + x) * 4; const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        const rotatedY = Math.round(-x * Math.sin(radians) + y * Math.cos(radians));
        if (rotatedY >= 0 && rotatedY < analHeight) bins[rotatedY] += (255 - brightness); 
      }
    }
    const avg = bins.reduce((a, b) => a + b, 0) / analHeight;
    const variance = bins.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / analHeight;
    if (variance > highestVariance) { highestVariance = variance; optimalAngle = angle; }
  }

  if (applyMode === 'all') imageStates.forEach(state => state.deskewAngle = -optimalAngle);
  else imageStates[currentIdx].deskewAngle = -optimalAngle; 
  syncUIWithState(); requestRender(); showToast("Auto-Deskew applied.");
});

document.getElementById('autoLightBtn').addEventListener('click', () => {
  if (!previewImage) return;
  if (applyMode === 'all') imageStates.forEach(state => { state.brightness = 110; state.contrast = 118; state.exposure = 10; });
  else { imageStates[currentIdx].brightness = 110; imageStates[currentIdx].contrast = 118; imageStates[currentIdx].exposure = 10; }
  syncUIWithState(); requestRender(); showToast("Auto-Levels applied.");
});

document.getElementById('autoSharpenBtn').addEventListener('click', () => {
  if (!previewImage) return;
  if (applyMode === 'all') imageStates.forEach(state => { state.sharpen = 25; state.pixelMathCanvas = null; });
  else { imageStates[currentIdx].sharpen = 25; imageStates[currentIdx].pixelMathCanvas = null; }
  syncUIWithState(); requestRender(); showToast("Auto-Sharpen applied (25%).");
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!previewImage) return;
  if (applyMode === 'all') {
    imageStates.forEach(state => { 
      state.brightness = 100; state.contrast = 100; state.saturation = 100; 
      state.hue = 0; state.exposure = 0; state.temp = 0; state.tint = 0; state.sharpen = 0;
      state.redChan = 0; state.greenChan = 0; state.blueChan = 0;
      state.pixelMathCanvas = null; 
    });
  } else {
    const state = imageStates[currentIdx];
    state.brightness = 100; state.contrast = 100; state.saturation = 100; 
    state.hue = 0; state.exposure = 0; state.temp = 0; state.tint = 0; state.sharpen = 0;
    state.redChan = 0; state.greenChan = 0; state.blueChan = 0;
    state.pixelMathCanvas = null;
  }
  syncUIWithState(); requestRender(); showToast("Filters reset.");
});


function generateProcessedCanvas(sourceImg, state, isPreview = false) {
   let baseImg = sourceImg;
   
   if (state.cropPts) {
      if (!isPreview) { 
         const scale = sourceImg.width / previewImage.width; 
         const scaledCrop = state.cropPts.map(p => ({ x: p.x * scale, y: p.y * scale }));
         baseImg = extractPerspectiveCrop(sourceImg, scaledCrop, null);
      } else {
         state.croppedCanvas = extractPerspectiveCrop(sourceImg, state.cropPts, state.croppedCanvas);
         baseImg = state.croppedCanvas;
      }
   }

   if (state.wbMultR !== 1 || state.wbMultG !== 1 || state.wbMultB !== 1 || state.sharpen > 0 || state.redChan !== 0 || state.greenChan !== 0 || state.blueChan !== 0) {
      if (!isPreview) {
         baseImg = applyPixelMath(baseImg, state, null);
      } else {
         state.pixelMathCanvas = applyPixelMath(baseImg, state, state.pixelMathCanvas);
         baseImg = state.pixelMathCanvas;
      }
   }

   const totalRadians = (state.deskewAngle * Math.PI) / 180;
   const w = baseImg.width; const h = baseImg.height;
   const cos = Math.abs(Math.cos(totalRadians)); const sin = Math.abs(Math.sin(totalRadians));
   const rotatedW = Math.round(w * cos + h * sin); 
   const rotatedH = Math.round(w * sin + h * cos);

   let outCanvas = isPreview ? globalPreviewOutCanvas : document.createElement('canvas');
   if (outCanvas.width !== rotatedW) outCanvas.width = rotatedW;
   if (outCanvas.height !== rotatedH) outCanvas.height = rotatedH;

   const oCtx = outCanvas.getContext('2d');
   oCtx.clearRect(0,0,rotatedW,rotatedH); 
   oCtx.save();
   
   oCtx.translate(rotatedW / 2, rotatedH / 2);
   oCtx.rotate(totalRadians);
   oCtx.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%) hue-rotate(${state.hue}deg)`;
   oCtx.drawImage(baseImg, -w / 2, -h / 2);

   if (state.exposure !== 0) {
     oCtx.globalCompositeOperation = state.exposure > 0 ? "screen" : "multiply";
     oCtx.fillStyle = `rgba(255, 255, 255, ${Math.abs(state.exposure) / 250})`;
     oCtx.fillRect(-w / 2, -h / 2, w, h); oCtx.globalCompositeOperation = "source-over"; 
   }
   if (state.temp !== 0) {
     oCtx.globalCompositeOperation = "color";
     oCtx.fillStyle = state.temp > 0 ? `rgba(255, 170, 0, ${state.temp / 500})` : `rgba(0, 100, 255, ${Math.abs(state.temp) / 500})`;
     oCtx.fillRect(-w / 2, -h / 2, w, h); oCtx.globalCompositeOperation = "source-over";
   }
   if (state.tint !== 0) {
     oCtx.globalCompositeOperation = "color";
     oCtx.fillStyle = state.tint > 0 ? `rgba(0, 255, 100, ${state.tint / 500})` : `rgba(255, 0, 150, ${Math.abs(state.tint) / 500})`;
     oCtx.fillRect(-w / 2, -h / 2, w, h); oCtx.globalCompositeOperation = "source-over";
   }
   oCtx.restore();
   return outCanvas;
}


function drawImage(overrideState = null, forceCropView = false) {
  if (!previewImage) return;
  const state = overrideState || imageStates[currentIdx];
  
  if (isCropMode || forceCropView) {
    if (canvas.width !== previewImage.width) canvas.width = previewImage.width;
    if (canvas.height !== previewImage.height) canvas.height = previewImage.height;
    
    ctx.clearRect(0,0,canvas.width,canvas.height); 
    ctx.drawImage(previewImage, 0, 0);

    if (tempCropPts) {
      ctx.beginPath();
      ctx.moveTo(0,0); ctx.lineTo(canvas.width, 0); ctx.lineTo(canvas.width, canvas.height); ctx.lineTo(0, canvas.height); ctx.lineTo(0,0);
      ctx.moveTo(tempCropPts[0].x, tempCropPts[0].y); ctx.lineTo(tempCropPts[3].x, tempCropPts[3].y); ctx.lineTo(tempCropPts[2].x, tempCropPts[2].y); ctx.lineTo(tempCropPts[1].x, tempCropPts[1].y); ctx.lineTo(tempCropPts[0].x, tempCropPts[0].y);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill('evenodd');
      
      ctx.beginPath();
      ctx.moveTo(tempCropPts[0].x, tempCropPts[0].y); ctx.lineTo(tempCropPts[1].x, tempCropPts[1].y); ctx.lineTo(tempCropPts[2].x, tempCropPts[2].y); ctx.lineTo(tempCropPts[3].x, tempCropPts[3].y); ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      tempCropPts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 2*Math.PI); ctx.fill(); ctx.stroke(); });
    }
    return; 
  }

  const render = generateProcessedCanvas(previewImage, state, true);
  
  if (canvas.width !== render.width) canvas.width = render.width;
  if (canvas.height !== render.height) canvas.height = render.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(render, 0, 0);
}

document.getElementById('downloadBtn').addEventListener('click', async () => {
  if (!imageQueue || imageQueue.length === 0) return showToast("Queue empty.");

  showToast(`Exporting ${imageQueue.length} files...`);
  
  const zip = new JSZip(); 
  const activeFormat = document.querySelector('input[name="format"]:checked').value;
  const extension = activeFormat.split('/')[1];
  const qVal = parseFloat(document.getElementById('quality').value) / 100;
  
  const isAutoW = autoWidth.checked; const isAutoH = autoHeight.checked;
  const isNoResize = noResize.checked;
  const inputW = parseFloat(resizeWidth.value); const inputH = parseFloat(resizeHeight.value);

  for (let i = 0; i < imageQueue.length; i++) {
    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const tempImg = new Image();
        tempImg.onload = () => {
          
          const highResCanvas = generateProcessedCanvas(tempImg, imageStates[i], false);
          
          let targetW = highResCanvas.width; let targetH = highResCanvas.height;
          const aspect = targetW / targetH;

          if (!isNoResize) {
            if (isAutoW && !isAutoH && inputH) { targetH = inputH; targetW = targetH * aspect; } 
            else if (isAutoH && !isAutoW && inputW) { targetW = inputW; targetH = targetW / aspect; } 
            else if (!isAutoW && !isAutoH && inputW && inputH) { targetW = inputW; targetH = inputH; }
          }

          const exportCanvas = document.createElement('canvas');
          exportCanvas.width = Math.round(targetW); exportCanvas.height = Math.round(targetH);
          exportCanvas.getContext('2d').drawImage(highResCanvas, 0, 0, highResCanvas.width, highResCanvas.height, 0, 0, targetW, targetH);
          
          const dataURL = exportCanvas.toDataURL(activeFormat, qVal);
          const base64Data = dataURL.split(',')[1];
          
          const fName = imageQueue[i].name;
          const lastDotIdx = fName.lastIndexOf('.');
          const originalName = lastDotIdx !== -1 ? fName.substring(0, lastDotIdx) : fName;
          
          zip.file(`enhanced_${originalName}.${extension}`, base64Data, {base64: true});
          resolve();
        };
        tempImg.src = event.target.result;
      };
      reader.readAsDataURL(imageQueue[i]);
    });
  }

  requestRender();
  showToast("Finalizing archive...");
  
  zip.generateAsync({type:"blob"}).then(function(content) {
      const dlLink = document.createElement('a');
      
      dlLink.download = `${exportZipName}.zip`;
      
      dlLink.href = URL.createObjectURL(content);
      document.body.appendChild(dlLink); dlLink.click(); document.body.removeChild(dlLink);
      showToast(`Export complete.`);
  });
});

/* MODAL LOGIC */
const modal = document.getElementById('manualModal');
const helpBtn = document.getElementById('helpBtn');
const closeModalBtn = document.getElementById('closeModalBtn');

helpBtn.addEventListener('click', () => {
  modal.style.display = 'flex';
});

closeModalBtn.addEventListener('click', () => {
  modal.style.display = 'none';
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.style.display = 'none';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === "Escape" && modal.style.display === 'flex') {
    modal.style.display = 'none';
  }
});

/* MEMORY PRESET LOGIC */
const savePresetBtn = document.getElementById('savePresetBtn');
const loadPresetBtn = document.getElementById('loadPresetBtn');

savePresetBtn.addEventListener('click', () => {
  if (!previewImage) return showToast("No image loaded to save settings from.");
  const state = imageStates[currentIdx];
  const preset = {
    deskewAngle: state.deskewAngle,
    brightness: state.brightness,
    contrast: state.contrast,
    saturation: state.saturation,
    hue: state.hue,
    exposure: state.exposure,
    temp: state.temp,
    tint: state.tint,
    sharpen: state.sharpen,
    wbMultR: state.wbMultR,
    wbMultG: state.wbMultG,
    wbMultB: state.wbMultB,
    wbAmount: state.wbAmount,
    redChan: state.redChan,
    greenChan: state.greenChan,
    blueChan: state.blueChan
  };
  localStorage.setItem('imgEnhancerPreset', JSON.stringify(preset));
  showToast("Settings saved to memory.");
});

loadPresetBtn.addEventListener('click', () => {
  if (!previewImage) return;
  const saved = localStorage.getItem('imgEnhancerPreset');
  if (!saved) return showToast("No saved settings found.");
  
  const preset = JSON.parse(saved);
  
  if (applyMode === 'all') {
    imageStates.forEach(state => {
      Object.assign(state, preset);
      state.pixelMathCanvas = null; 
    });
  } else {
    Object.assign(imageStates[currentIdx], preset);
    imageStates[currentIdx].pixelMathCanvas = null;
  }
  
  syncUIWithState();
  requestRender();
  showToast("Memory preset applied.");
});