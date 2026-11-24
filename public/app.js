const $ = s => document.querySelector(s);
let token = localStorage.getItem("rei_token") || "";
let me = null, selectedOwner = null, properties = [], users = [], forcedPasswordChange = false;
const sectors = ["غرب","شمال","شرق","جنوب","وسط"];
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => Number(n||0).toLocaleString("ar-EG");
async function api(url, options={}) {
 const headers = {...(options.headers||{})};
 if (token) headers.Authorization = `Bearer ${token}`;
 if (options.body) headers["Content-Type"]="application/json";
 const r=await fetch(url,{...options,headers});
 const data=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(data.error||"حدث خطأ");
 return data;
}
function showLogin(){ $("#loginView").classList.remove("hidden");$("#appView").classList.add("hidden"); }
function showApp(){ $("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden"); }
function statusClass(s){return s==="موجود"?"available":s==="اتباع"?"sold":"unavailable";}
function canEdit(p){return me.role==="ADMIN" || p.owner_user_id===me.id;}
function canDelete(p){return me.role==="ADMIN";}
function ownerForUser(u){return u.username;}
function renderLinks(){
 const leaders=users.filter(u=>u.role==="LEADER");
 $("#sheetLinks").innerHTML=leaders.map(u=>`<button class="sheet-link ${selectedOwner===u.username?"active":""}" data-owner="${esc(u.username)}"><span>▤ ${esc(u.displayName)}</span><small>${esc(u.sector||"")}</small></button>`).join("");
 document.querySelectorAll("[data-owner]").forEach(b=>b.addEventListener("click",async()=>{
   selectedOwner=b.dataset.owner;
   renderLinks();
   await loadProperties();
 }));
}
function renderStats(){
 const total=properties.length, available=properties.filter(p=>p.status==="موجود").length, sold=properties.filter(p=>p.status==="اتباع").length, unavailable=properties.filter(p=>p.status==="غير متوفر حاليا").length;
 $("#statsCards").innerHTML=[["إجمالي العقارات",total],["موجود",available],["اتباع",sold],["غير متوفر حاليا",unavailable]].map(([a,b])=>`<div class="stat"><span>${a}</span><b>${b}</b></div>`).join("");
}
function renderRows(){
 const rows=properties;
 $("#propertyRows").innerHTML=rows.map(p=>`<tr class="property-row" data-property="${p.id}" tabindex="0" title="اضغط لعرض كل التفاصيل">
 <td data-label="الموظف / الوكيل">${esc(p.agent_name)}</td><td data-label="نوع العميل">${esc(p.client_type)}</td><td data-label="الاسم">${esc(p.client_name)}</td><td data-label="رقم الهاتف">${esc(p.phone)}</td><td data-label="العنوان التفصيلي" title="${esc(p.address)}">${esc(p.address.length>42?p.address.slice(0,42)+"…":p.address)}</td><td data-label="السعر">${money(p.price)}</td><td data-label="مواصفات العقار" style="white-space:normal;min-width:220px;line-height:1.8">النوع: ${esc(p.property_type)}<br>المساحة: ${p.area??"—"} م² · الدور: ${esc(p.floor||"—")}<br>التشطيب: ${esc(p.finishing||"—")}<br>المرافق: ${esc(p.utilities||"—")}<br>نسبة الأرض: ${esc(p.land_share||"—")}<br>التقسيم: ${esc(p.layout||"—")}</td><td data-label="الحالة"><span class="pill ${statusClass(p.status)}">${esc(p.status)}</span></td><td data-label="إجراء">${canEdit(p)?`<button class="secondary small-btn" data-edit="${p.id}">تعديل</button>`:`<span class="readonly">عرض فقط</span>`}${canDelete(p)?` <button class="danger small-btn" data-delete="${p.id}">حذف</button>`:""}</td>
 </tr>`).join("");
 $("#emptyState").classList.toggle("hidden",rows.length>0);
 document.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEdit(Number(b.dataset.edit))));
 document.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();deleteProperty(Number(b.dataset.delete));}));
 document.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",e=>e.stopPropagation()));
 document.querySelectorAll(".property-row").forEach(row=>{
   const open=()=>showPropertyDetails(Number(row.dataset.property));
   row.addEventListener("click",e=>{if(e.target.closest("button"))return;open();});
   row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
 });
}
function detailItem(label,value){
 const shown=(value===null||value===undefined||String(value).trim()==="")?"غير مسجل":String(value);
 return `<div class="detail-item"><span>${esc(label)}</span><span>${esc(shown)}</span></div>`;
}
function showPropertyDetails(id){
 const p=properties.find(x=>Number(x.id)===Number(id));if(!p)return;
 const editable=canEdit(p);
 const status=`<span class="pill ${statusClass(p.status)}">${esc(p.status)}</span>`;
 $("#propertyListView").classList.add("hidden");
 $("#propertyDetailView").classList.remove("hidden");
 $("#propertyDetailView").innerHTML=`
  <div class="detail-top"><button class="secondary" id="backToProperties">← الرجوع للشيت</button><h2>تفاصيل العقار</h2></div>
  <div class="detail-hero"><div class="eyebrow">نظام ناصيه · ملف عقار رقم ${esc(p.id)}</div><h3>${esc(p.property_type||"عقار")} – ${esc(p.client_name)}</h3><p>${esc(p.address)}</p><p>${status} <span style="margin-right:8px">السعر: ${money(p.price)} جنيه</span></p></div>
  <div class="detail-grid">
   <section class="detail-card"><h4>بيانات العقار الأساسية</h4>${detailItem("رقم العقار",p.id)}${detailItem("نوع العقار",p.property_type)}${detailItem("حالة العقار",p.status)}${detailItem("السعر",`${money(p.price)} جنيه`)}${detailItem("المساحة",p.area?`${p.area} م²`:"")}${detailItem("الدور",p.floor)}${detailItem("التشطيب",p.finishing)}${detailItem("المرافق والعدادات",p.utilities)}${detailItem("نسبة الأرض",p.land_share)}${detailItem("التقسيم الداخلي",p.layout)}</section>
   <section class="detail-card"><h4>بيانات المالك / العميل</h4>${detailItem("نوع العميل",p.client_type)}${detailItem("اسم المالك / المشتري",p.client_name)}${detailItem("رقم الهاتف",p.phone)}${detailItem("العنوان التفصيلي",p.address)}</section>
   <section class="detail-card"><h4>بيانات المسؤولية والإضافة</h4>${detailItem("الموظف / الوكيل",p.agent_name)}${detailItem("التيم ليدر المسؤول",p.owner_name)}${detailItem("القطاع",p.owner_sector)}${detailItem("اسم مستخدم الشيت",p.owner_username)}${detailItem("تاريخ الإضافة",p.created_at)}${detailItem("آخر تحديث",p.updated_at)}</section>
   <section class="detail-card"><h4>الصلاحيات</h4>${detailItem("صلاحيتك على العقار",editable?"يمكنك التعديل والحذف":"مشاهدة فقط")}${detailItem("الشيت الأصلي",p.owner_name?`شيت ${p.owner_name}`:"غير محدد")}<p class="muted" style="font-size:12px;line-height:1.8;margin:10px 0 0">يظل العقار تابعًا لشيت الليدر الذي أضافه. فتح التفاصيل لا ينقل ملكية العقار ولا يغيّر بياناته.</p></section>
  </div>
  <div class="detail-actions">${editable?`<button class="primary" id="detailEdit">تعديل بيانات العقار</button>`:`<span class="readonly">يمكنك الاطلاع على التفاصيل فقط.</span>`}${canDelete(p)?`<button class="danger" id="detailDelete">حذف العقار</button>`:""}</div>`;
 $("#backToProperties").onclick=()=>{
   $("#propertyDetailView").classList.add("hidden");$("#propertyListView").classList.remove("hidden");
 };
 if(editable){
   $("#detailEdit").onclick=()=>{ $("#propertyDetailView").classList.add("hidden");$("#propertyListView").classList.remove("hidden");openEdit(Number(p.id)); };
 }
 if(canDelete(p)){
   $("#detailDelete").onclick=async()=>{await deleteProperty(Number(p.id));$("#propertyDetailView").classList.add("hidden");$("#propertyListView").classList.remove("hidden");};
 }
 window.scrollTo({top:0,behavior:"smooth"});
}

async function loadProperties(){
 $("#propertyDetailView")?.classList.add("hidden");
 $("#propertyListView")?.classList.remove("hidden");
 const owner=selectedOwner||me.username;
 const q=$("#searchBox").value.trim(), status=$("#statusFilter").value;
 const data=await api(`/api/properties?owner=${encodeURIComponent(owner)}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
 // Always render the selected leader's records, regardless of which leader is signed in.

 properties=data.properties; const ownerUser=users.find(u=>u.username===owner);
 $("#sheetTitle").textContent=ownerUser?`شيت ${ownerUser.displayName} – قطاع ${ownerUser.sector||"الإدارة"}`:"شيت العقارات";
 $("#sheetSub").textContent=owner===me.username?"يمكنك الإضافة والتعديل والحذف في شيتك.":"شيت زميلك – صلاحية مشاهدة فقط.";
 const ownSheet=me.role==="ADMIN"||owner===me.username;
 $("#addBtn").classList.toggle("hidden",!ownSheet);
 $("#permissionHint").textContent=ownSheet?"لديك صلاحية إدارة هذا الشيت":"هذا الشيت للعرض فقط";
 renderStats();renderRows();
}
async function loadAdminStats(){
 if(me.role!=="ADMIN")return;
 const data=await api("/api/stats");
 $("#adminStats").classList.remove("hidden");
 $("#statsRows").innerHTML=data.stats.map(s=>`<tr><td>${esc(s.sector)}</td><td>${esc(s.displayName)}</td><td>${s.total||0}</td><td>${s.available||0}</td><td>${s.sold||0}</td><td>${s.unavailable||0}</td></tr>`).join("");
}
async function refresh(){
 const data=await api("/api/users");users=data.users;
 if(me.role==="ADMIN"){$("#adminTools").classList.remove("hidden");$("#changePassBtn").classList.remove("hidden");}else{$("#adminTools").classList.add("hidden");$("#changePassBtn").classList.add("hidden");}
 if(!selectedOwner)selectedOwner=me.role==="LEADER"?me.username:users.find(u=>u.role==="LEADER")?.username;
 $("#userInfo").textContent=`${me.displayName} · ${me.role==="ADMIN"?"Admin":"Team Leader"}`;
 renderLinks();await loadProperties();await loadAdminStats();
}
function openModal(){
 $("#propertyForm").reset();$("#propertyForm").elements.id.value="";
 $("#modalTitle").textContent="إضافة عقار";$("#formError").classList.add("hidden");
 const wrap=$("#targetSheetWrap"), select=$("#targetSheet");
 if(me.role==="ADMIN"){
   wrap.classList.remove("hidden");
   select.innerHTML=users.filter(u=>u.role==="LEADER").map(u=>`<option value="${esc(u.username)}" ${u.username===selectedOwner?"selected":""}>${esc(u.displayName)} – ${esc(u.sector)}</option>`).join("");
 } else { wrap.classList.add("hidden"); }
 $("#modal").classList.remove("hidden");
}
function closeModal(){ $("#modal").classList.add("hidden");}
function openEdit(id){
 const p=properties.find(x=>x.id===id);if(!p||!canEdit(p))return;
 const f=$("#propertyForm");
 const map={id:"id",agent_name:"agentName",client_type:"clientType",client_name:"clientName",phone:"phone",address:"address",price:"price",area:"area",floor:"floor",finishing:"finishing",utilities:"utilities",land_share:"landShare",layout:"layout",property_type:"propertyType",status:"status"};
 Object.entries(map).forEach(([k,n])=>f.elements[n].value=p[k]??"");
 $("#modalTitle").textContent="تعديل بيانات العقار";$("#formError").classList.add("hidden");$("#modal").classList.remove("hidden");
}
async function deleteProperty(id){
 const p=properties.find(x=>x.id===id);if(!p||!canDelete(p))return;
 if(!confirm("هل أنت متأكد من حذف هذا العقار؟ هذا الإجراء متاح للأدمن فقط."))return;
 try{await api(`/api/properties/${id}`,{method:"DELETE"});await loadProperties();}catch(e){alert(e.message);}
}
$("#loginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("#loginError").classList.add("hidden");
 const fd=new FormData(e.currentTarget);
 try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({username:fd.get("username"),password:fd.get("password")})});token=d.token;localStorage.setItem("rei_token",token);me=d.user;await 

boot();}catch(err){$("#loginError").textContent=err.message;$("#loginError").classList.remove("hidden");}
});
async function boot(){
 try{
   const d=await api("/api/me");
   me=d.user;
   forcedPasswordChange=me.role==="ADMIN" && !!me.mustChange;
   showApp();
   if(forcedPasswordChange){ openPasswordModal(true); return; }
   await refresh();
 }
 catch{token="";me=null;localStorage.removeItem("rei_token");showLogin();}
}
$("#logoutBtn").onclick=async()=>{try{await api("/api/logout",{method:"POST"});}catch{}token="";me=null;localStorage.removeItem("rei_token");showLogin();};
$("#addBtn").onclick=openModal;$("#closeModal").onclick=closeModal;$("#cancelModal").onclick=closeModal;
$("#propertyForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=e.currentTarget,fd=new FormData(f),id=fd.get("id");
 const b={};for(const [k,v] of fd.entries())if(k!=="id")b[k]=v;
 if(me.role==="ADMIN" && !id) b.ownerUsername=$("#targetSheet").value;
 $("#formError").classList.add("hidden");
 try{await api(id?`/api/properties/${id}`:"/api/properties",{method:id?"PUT":"POST",body:JSON.stringify(b)});closeModal();await loadProperties();await loadAdminStats();}
 catch(err){$("#formError").textContent=err.message;$("#formError").classList.remove("hidden");}
});
$("#searchBox").addEventListener("input",()=>loadProperties());$("#statusFilter").onchange=loadProperties;$("#refreshBtn").onclick=()=>refresh();
function openPasswordModal(force=false){
 forcedPasswordChange=force || forcedPasswordChange;
 $("#passForm").reset();
 $("#passError").classList.add("hidden");
 $("#passSuccess").classList.add("hidden");
 $("#passModal").classList.remove("hidden");
 $("#closePass").classList.toggle("hidden",forcedPasswordChange);
 $("#passModal .modal-head h3").textContent=forcedPasswordChange?"يجب تغيير كلمة المرور":"تغيير كلمة المرور";
 $("#passModal .modal-head").querySelector("p")?.remove();
 if(forcedPasswordChange){
   const note=document.createElement("p");
   note.textContent="لأمان حسابك، يجب تعيين كلمة مرور جديدة قبل استخدام النظام.";
   note.className="muted";
   $("#passModal .modal-head").append(note);
 }
}
$("#changePassBtn").onclick=()=>openPasswordModal(false);
$("#closePass").onclick=()=>{if(!forcedPasswordChange)$("#passModal").classList.add("hidden");};
$("#passForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const fd=new FormData(e.currentTarget);
 try{
   await api("/api/change-password",{method:"POST",body:JSON.stringify({currentPassword:fd.get("currentPassword"),newPassword:fd.get("newPassword")})});
   me.mustChange=0;
   forcedPasswordChange=false;
   await refresh();
   $("#passSuccess").textContent="تم تغيير كلمة المرور بنجاح";
   $("#passSuccess").classList.remove("hidden");
   $("#passError").classList.add("hidden");
   $("#closePass").classList.remove("hidden");
   $("#passModal .modal-head h3").textContent="تغيير كلمة المرور";
   setTimeout(()=>$("#passModal").classList.add("hidden"),900);
 }catch(err){
   $("#passError").textContent=err.message;
   $("#passError").classList.remove("hidden");
 }
});
$("#usersBtn").onclick=async()=>{await loadUsers();$("#usersModal").classList.remove("hidden");};$("#closeUsers").onclick=()=>$("#usersModal").classList.add("hidden");
async function loadUsers(){const d=await api("/api/users");$("#usersList").innerHTML=d.users.map(u=>`<div style="padding:10px;border-bottom:1px solid var(--line);font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>${esc(u.username)} — ${esc(u.displayName)} — ${u.role==="ADMIN"?"Admin":`قطاع ${esc(u.sector)}`}</span><button class="secondary small-btn" data-reset-password="${u.id}">تعيين كلمة مرور</button></div>`).join("");document.querySelectorAll("[data-reset-password]").forEach(b=>b.onclick=async()=>{const password=prompt("اكتب كلمة المرور الجديدة (10 أحرف على الأقل):");if(password===null)return;if(password.length<10){alert("كلمة المرور يجب ألا تقل عن 10 أحرف");return;}try{await api(`/api/users/${b.dataset.resetPassword}/password`,{method:"PUT",body:JSON.stringify({password})});alert("تم تعيين كلمة المرور بنجاح");}catch(e){alert(e.message);}});}
$("#userForm").addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const body=Object.fromEntries(fd.entries());try{await api("/api/users",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();$("#usersError").classList.add("hidden");await loadUsers();await refresh();alert("تم إنشاء الحساب");}catch(err){$("#usersError").textContent=err.message;$("#usersError").classList.remove("hidden");}});

const backupBtn=$("#backupBtn");
if(backupBtn){
 backupBtn.addEventListener("click",async()=>{
   const oldText=backupBtn.textContent;
   backupBtn.disabled=true;backupBtn.textContent="جارٍ تجهيز النسخة الاحتياطية...";
   try{
     const response=await fetch("/api/backup.xlsx",{headers:{Authorization:`Bearer ${token}`}});
     if(!response.ok){
       const err=await response.json().catch(()=>({}));
       throw new Error(err.error||"تعذر تنزيل النسخة الاحتياطية");
     }
     const blob=await response.blob();
     const url=URL.createObjectURL(blob);
     const link=document.createElement("a");
     link.href=url;link.download=`NASIAH-Backup-${new Date().toISOString().slice(0,10)}.xlsx`;
     document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
   }catch(err){alert(err.message);}
   finally{backupBtn.disabled=false;backupBtn.textContent=oldText;}
 });
}

boot();
