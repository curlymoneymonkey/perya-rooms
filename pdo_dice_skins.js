import { auth, db, storage, waitForAuthState } from "./firebase.js";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

const COLORS = ["red", "blue", "green", "yellow", "purple", "orange"];
const CLASSIC_IMAGES = Object.fromEntries(COLORS.map(color => [color, `images/${color}.png`]));
const form = document.getElementById("skinForm");
const nameInput = document.getElementById("skinName");
const accessInputs = [...document.querySelectorAll('input[name="skinAccess"]')];
const enabledInput = document.getElementById("skinEnabled");
const uploadGrid = document.getElementById("uploadGrid");
const preview = document.getElementById("dicePreview");
const message = document.getElementById("skinMessage");
const list = document.getElementById("skinList");
const saveButton = document.getElementById("saveSkinButton");
const cancelButton = document.getElementById("cancelEditButton");
const title = document.getElementById("skinFormTitle");
const subtitle = document.getElementById("skinFormSubtitle");
let currentUser = null;
let editingId = null;
let editingSkin = null;
let skins = [];
let busy = false;
const fileInputs = new Map();
const objectUrls = new Map();

function setMessage(text, error = false) { message.textContent = text; message.classList.toggle("error", error); }
function escapeHtml(value) { const d=document.createElement("div"); d.textContent=String(value ?? ""); return d.innerHTML; }
function normalizeAccessLevels(skin) {
  const raw = Array.isArray(skin?.accessLevels)
    ? skin.accessLevels
    : [String(skin?.accessLevel || "everyone")];
  return [...new Set(raw.filter(level => ["everyone", "users", "vip"].includes(level)))];
}
function selectedAccessLevels() { return accessInputs.filter(input => input.checked).map(input => input.value); }
function setSelectedAccessLevels(levels) {
  const selected = new Set(Array.isArray(levels) ? levels : []);
  accessInputs.forEach(input => { input.checked = selected.has(input.value); });
}
function accessLabel(skin) {
  const labels = { everyone: "Everyone / Guests", users: "Logged-in users", vip: "VIP users" };
  const levels = normalizeAccessLevels(skin);
  return levels.length ? levels.map(level => labels[level]).join(", ") : "No access groups";
}
function imageMap(skin) { return skin?.images || {}; }

function buildUploads() {
  uploadGrid.innerHTML = "";
  COLORS.forEach(color => {
    const card = document.createElement("div"); card.className = "upload-card";
    card.innerHTML = `<label><span>${color[0].toUpperCase()+color.slice(1)} Dice</span><div class="upload-thumb" id="thumb-${color}"><span class="upload-placeholder">No image selected</span></div><input id="file-${color}" type="file" accept="image/png,image/webp,.png,.webp"></label><div class="upload-progress" id="progress-${color}"></div>`;
    uploadGrid.appendChild(card);
    const input = card.querySelector("input"); fileInputs.set(color,input);
    input.addEventListener("change", () => previewFile(color,input.files?.[0]));
  });
}
function setThumb(color, src) { const thumb=document.getElementById(`thumb-${color}`); thumb.innerHTML=src?`<img src="${escapeHtml(src)}" alt="${color} dice preview">`:`<span class="upload-placeholder">No image selected</span>`; renderPreview(); }
function previewFile(color,file) { if(objectUrls.has(color)) URL.revokeObjectURL(objectUrls.get(color)); if(!file){objectUrls.delete(color);setThumb(color,imageMap(editingSkin)[color]||"");return;} const url=URL.createObjectURL(file);objectUrls.set(color,url);setThumb(color,url); }
function renderPreview(){ preview.innerHTML=""; COLORS.forEach(color=>{const src=objectUrls.get(color)||imageMap(editingSkin)[color]||""; if(src){const img=document.createElement("img");img.src=src;img.alt=`${color} dice`;preview.appendChild(img);}}); if(!preview.children.length) preview.innerHTML='<span class="skin-help">Your six dice previews will appear here.</span>'; }
function clearObjectUrls(){objectUrls.forEach(url=>URL.revokeObjectURL(url));objectUrls.clear();}
function resetForm(){ editingId=null;editingSkin=null;clearObjectUrls();form.reset();enabledInput.checked=true;setSelectedAccessLevels(["everyone"]);title.textContent="Create Dice Skin";subtitle.textContent="Add a new selectable dice design.";saveButton.textContent="Create Skin";cancelButton.hidden=true;fileInputs.forEach((input,color)=>{input.value="";setThumb(color,"");document.getElementById(`progress-${color}`).textContent="";});setMessage("");renderPreview(); }
async function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve([image.naturalWidth, image.naturalHeight]);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };

    image.src = url;
  });
}

async function validateImage(file) {
  if (!file) return;

  const allowedTypes = new Set(["image/png", "image/webp"]);
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowedExtension = extension === "png" || extension === "webp";

  if (!allowedTypes.has(file.type) && !allowedExtension) {
    throw new Error(`${file.name} must be a PNG or WebP image.`);
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`${file.name} is larger than 5 MB.`);
  }

  const [width, height] = await readImageDimensions(file);
  if (width !== height) {
    throw new Error(`${file.name} must be square.`);
  }
}

async function convertPngToWebP(file) {
  if (file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp")) {
    return file;
  }

  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    image.close?.();
    throw new Error(`Could not optimize ${file.name}.`);
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  image.close?.();

  const blob = await new Promise(resolve => {
    canvas.toBlob(resolve, "image/webp", 0.92);
  });

  if (!blob) {
    throw new Error(`Could not convert ${file.name} to WebP.`);
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "dice";
  return new File([blob], `${baseName}.webp`, {
    type: "image/webp",
    lastModified: Date.now()
  });
}

async function uploadColor(skinId, color, file) {
  const progress = document.getElementById(`progress-${color}`);
  progress.textContent = file.type === "image/png" ? "Optimizing…" : "Preparing…";

  const optimizedFile = await convertPngToWebP(file);
  progress.textContent = "Uploading…";

  const storageRef = ref(
    storage,
    `dice-skins/${skinId}/${color}-${Date.now()}.webp`
  );

  await uploadBytes(storageRef, optimizedFile, {
    contentType: "image/webp",
    cacheControl: "public,max-age=31536000,immutable"
  });

  const url = await getDownloadURL(storageRef);
  progress.textContent = "Uploaded as WebP";
  return url;
}
async function verifyAdmin(){ currentUser=await waitForAuthState(); if(!currentUser||currentUser.isAnonymous) throw new Error("Administrator sign-in required."); const snap=await getDoc(doc(db,"admins",currentUser.uid)); if(!snap.exists()||snap.data().enabled!==true) throw new Error("Administrator access required."); }
async function ensureClassic(){
  const classicRef=doc(db,"diceSkins","classic");
  const snap=await getDoc(classicRef);
  if(!snap.exists()) {
    await setDoc(classicRef,{name:"Classic Dice",accessLevels:["everyone","users","vip"],enabled:true,builtIn:true,images:CLASSIC_IMAGES,createdBy:currentUser.uid,createdAt:serverTimestamp(),updatedBy:currentUser.uid,updatedAt:serverTimestamp()});
  } else if (!Array.isArray(snap.data().accessLevels)) {
    await updateDoc(classicRef,{accessLevels:normalizeAccessLevels(snap.data()),updatedBy:currentUser.uid,updatedAt:serverTimestamp()});
  }
}
async function loadSkins(){ list.innerHTML='<div class="pdo-empty">Loading dice skins…</div>';const snap=await getDocs(collection(db,"diceSkins"));skins=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.id==="classic"?-1:b.id==="classic"?1:String(a.name||"").localeCompare(String(b.name||""))));renderList(); }
function renderList(){ if(!skins.length){list.innerHTML='<div class="pdo-empty">No skins have been created.</div>';return;}list.innerHTML="";skins.forEach(skin=>{const builtIn=skin.id==="classic"||skin.builtIn===true;const images=imageMap(skin);const card=document.createElement("article");card.className="skin-card";card.innerHTML=`<div class="skin-card-head"><div><h3>${escapeHtml(skin.name||"Unnamed Skin")}${builtIn?' <span class="pdo-badge">Built-in</span>':''}</h3><p class="skin-meta">${escapeHtml(accessLabel(skin))} · ID: ${escapeHtml(skin.id)}</p></div><span class="skin-status ${skin.enabled===true?'enabled':'disabled'}">${skin.enabled===true?'Enabled':'Disabled'}</span></div><div class="skin-card-preview">${COLORS.map(c=>images[c]?`<img src="${escapeHtml(images[c])}" alt="${c} dice">`:"").join("")}</div><div class="skin-card-actions"><button class="pdo-button secondary" data-edit="${escapeHtml(skin.id)}">Edit</button><button class="pdo-button secondary" data-toggle="${escapeHtml(skin.id)}">${skin.enabled===true?'Disable':'Enable'}</button>${builtIn?'':'<button class="pdo-button danger" data-delete="'+escapeHtml(skin.id)+'">Delete</button>'}</div>`;list.appendChild(card);}); }
function startEdit(id){const skin=skins.find(s=>s.id===id);if(!skin)return;editingId=id;editingSkin=skin;clearObjectUrls();nameInput.value=skin.name||"";setSelectedAccessLevels(normalizeAccessLevels(skin));enabledInput.checked=skin.enabled===true;title.textContent=`Edit ${skin.name||"Skin"}`;subtitle.textContent="Replace only the images you want to change.";saveButton.textContent="Save Changes";cancelButton.hidden=false;fileInputs.forEach((input,color)=>{input.value="";setThumb(color,imageMap(skin)[color]||"");});window.scrollTo({top:0,behavior:"smooth"});}
async function removeStoredImages(skin){for(const url of Object.values(imageMap(skin))){if(typeof url!=="string"||!url.includes("firebasestorage"))continue;try{await deleteObject(ref(storage,url));}catch(error){console.warn("Could not delete stored image",error);}}}
form.addEventListener("submit",async event=>{event.preventDefault();if(busy)return;busy=true;saveButton.disabled=true;setMessage("Validating images…");try{const files=Object.fromEntries(COLORS.map(c=>[c,fileInputs.get(c).files?.[0]||null]));for(const f of Object.values(files))await validateImage(f);if(!editingId&&COLORS.some(c=>!files[c]))throw new Error("Upload all six dice images before creating the skin.");const name=nameInput.value.trim();if(!name)throw new Error("Enter a skin name.");const accessLevels=selectedAccessLevels();if(!accessLevels.length)throw new Error("Select at least one access group.");let skinId=editingId;if(!skinId){skinId=doc(collection(db,"diceSkins")).id;}const images={...imageMap(editingSkin)};for(const color of COLORS){if(files[color])images[color]=await uploadColor(skinId,color,files[color]);}if(COLORS.some(c=>!images[c]))throw new Error("All six dice images are required.");await setDoc(doc(db,"diceSkins",skinId),{name,accessLevels,enabled:enabledInput.checked,builtIn:skinId==="classic",images,updatedBy:currentUser.uid,updatedAt:serverTimestamp(),...(editingId?{}:{createdBy:currentUser.uid,createdAt:serverTimestamp()})},{merge:true});setMessage(editingId?"Dice skin updated successfully.":"Dice skin created successfully.");await loadSkins();resetForm();}catch(error){console.error(error);setMessage(error.message||"Could not save the dice skin.",true);}finally{busy=false;saveButton.disabled=false;}});
list.addEventListener("click",async event=>{const edit=event.target.closest("[data-edit]");if(edit){startEdit(edit.dataset.edit);return;}const toggle=event.target.closest("[data-toggle]");if(toggle){const skin=skins.find(s=>s.id===toggle.dataset.toggle);if(!skin)return;toggle.disabled=true;try{await updateDoc(doc(db,"diceSkins",skin.id),{enabled:skin.enabled!==true,updatedBy:currentUser.uid,updatedAt:serverTimestamp()});await loadSkins();}catch(error){alert(error.message);}return;}const del=event.target.closest("[data-delete]");if(del){const skin=skins.find(s=>s.id===del.dataset.delete);if(!skin||!confirm(`Delete ${skin.name}? This cannot be undone.`))return;del.disabled=true;try{await removeStoredImages(skin);await deleteDoc(doc(db,"diceSkins",skin.id));if(editingId===skin.id)resetForm();await loadSkins();}catch(error){alert(error.message);}}});
document.getElementById("resetSkinButton").addEventListener("click",resetForm);cancelButton.addEventListener("click",resetForm);document.getElementById("refreshSkinsButton").addEventListener("click",loadSkins);
buildUploads();renderPreview();
try{await verifyAdmin();await ensureClassic();await loadSkins();}catch(error){console.error(error);setMessage(error.message||"Could not open Dice Skin Management.",true);form.querySelectorAll("input,select,button").forEach(el=>el.disabled=true);list.innerHTML='<div class="pdo-empty">Administrator access is required.</div>';}
