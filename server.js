import express from "express";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
await db.init();

function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function verifyPassword(password, saltB64, hashB64) {
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}
function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

async function seedInitialAccounts() {
  const seedPath = path.join(__dirname, "seed-accounts.json");
  let seed = [];
  try {
    seed = JSON.parse(await fs.promises.readFile(seedPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  for (const row of seed) {
    await db.run(`INSERT INTO users
      (username,display_name,role,sector,salt,password_hash)
      VALUES(?,?,?,?,?,?) ON CONFLICT(username) DO NOTHING`,
    row.username, row.displayName, row.role, row.sector, row.salt, row.passwordHash);
  }

  if (await db.get("SELECT id FROM users LIMIT 1")) return;
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("Set both INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD to bootstrap the first admin.");
  }
  if (username && password) {
    if (password.length < 16) {
      throw new Error("INITIAL_ADMIN_PASSWORD must be at least 16 characters.");
    }
    const record = makePasswordRecord(password);
    await db.run(`INSERT INTO users
      (username,display_name,role,salt,password_hash,must_change_password)
      VALUES(?,?,'ADMIN',?,?,TRUE)`,
    username.trim(), process.env.INITIAL_ADMIN_DISPLAY_NAME || "Administrator", record.salt, record.hash);
  }
  if (!(await db.get("SELECT id FROM users LIMIT 1"))) {
    throw new Error("No users exist. Add seed-accounts.json or set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD.");
  }
}

await seedInitialAccounts();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const isUniqueViolation = error => error.code === "23505" || error.code === "SQLITE_CONSTRAINT_UNIQUE";

const auth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "سجّل الدخول أولاً" });
  const row = await db.get(`SELECT u.id,u.username,u.display_name AS "displayName",u.role,u.sector,u.must_change_password AS "mustChange"
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, hashToken(token), Date.now());
  if (!row) return res.status(401).json({ error: "انتهت الجلسة، سجّل الدخول مرة أخرى" });
  req.user = row;
  req.token = token;
  if (row.role === "ADMIN" && row.mustChange && !["/api/me", "/api/change-password", "/api/logout"].includes(req.path)) {
    return res.status(403).json({ error: "يجب تغيير كلمة المرور أولاً قبل استخدام النظام" });
  }
  next();
});
function adminOnly(req, res, next) {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "الصلاحية غير كافية" });
  next();
}
function canManage(req, property) {
  return req.user.role === "ADMIN" || property.owner_user_id === req.user.id;
}
const safeUser = u => ({ id:u.id, username:u.username, displayName:u.display_name, role:u.role, sector:u.sector });

app.post("/api/login", asyncHandler(async (req,res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error:"اكتب اسم المستخدم وكلمة المرور" });
  const u = await db.get("SELECT * FROM users WHERE username=?", String(username).trim());
  if (!u || !verifyPassword(String(password), u.salt, u.password_hash)) return res.status(401).json({ error:"اسم المستخدم أو كلمة المرور غير صحيحة" });
  const token = crypto.randomBytes(32).toString("hex");
  await db.run("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", hashToken(token),u.id,Date.now()+7*24*60*60*1000);
  res.json({ token, user:safeUser(u), mustChangePassword:!!u.must_change_password });
}));
app.get("/api/me", auth, (req,res) => res.json({ user:req.user }));
app.post("/api/logout", auth, asyncHandler(async (req,res) => {
  await db.run("DELETE FROM sessions WHERE token_hash=?", hashToken(req.token));
  res.json({ ok:true });
}));
app.post("/api/change-password", auth, adminOnly, asyncHandler(async (req,res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = await db.get("SELECT * FROM users WHERE id=?", req.user.id);
  if (!verifyPassword(String(currentPassword||""),u.salt,u.password_hash)) return res.status(400).json({error:"كلمة المرور الحالية غير صحيحة"});
  if (typeof newPassword !== "string" || newPassword.length < 10) return res.status(400).json({error:"كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف"});
  const record = makePasswordRecord(newPassword);
  await db.run("UPDATE users SET salt=?,password_hash=?,must_change_password=FALSE WHERE id=?",record.salt,record.hash,u.id);
  res.json({ok:true});
}));
app.get("/api/users", auth, asyncHandler(async (req,res) => {
  const users = await db.all("SELECT id,username,display_name,role,sector FROM users ORDER BY role DESC, sector");
  res.json({ users:users.map(safeUser) });
}));
app.post("/api/users", auth, adminOnly, asyncHandler(async (req,res) => {
  const { username, displayName, role, sector, password } = req.body || {};
  if (!username || !displayName || !["ADMIN","LEADER"].includes(role) || !password || password.length < 10)
    return res.status(400).json({error:"بيانات الحساب غير مكتملة، وكلمة المرور 10 أحرف على الأقل"});
  if (role === "LEADER" && !sector) return res.status(400).json({error:"حدد القطاع"});
  const rec = makePasswordRecord(password);
  try {
    const inserted = await db.get(`INSERT INTO users(username,display_name,role,sector,salt,password_hash,must_change_password)
      VALUES(?,?,?,?,?,?,FALSE) RETURNING id`, username.trim(),displayName.trim(),role,role==="LEADER"?sector:null,rec.salt,rec.hash);
    res.json({ user:safeUser(await db.get("SELECT * FROM users WHERE id=?", inserted.id)) });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({error:"اسم المستخدم مستخدم بالفعل"});
  }
}));
app.put("/api/users/:id/password", auth, adminOnly, asyncHandler(async (req,res) => {
  const id = Number(req.params.id);
  const user = await db.get("SELECT id FROM users WHERE id=?", id);
  if (!user) return res.status(404).json({error:"الحساب غير موجود"});
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length < 10)
    return res.status(400).json({error:"كلمة المرور يجب ألا تقل عن 10 أحرف"});
  const record = makePasswordRecord(password);
  await db.run("UPDATE users SET salt=?,password_hash=?,must_change_password=FALSE WHERE id=?",record.salt,record.hash,id);
  res.json({ok:true});
}));

app.get("/api/properties", auth, asyncHandler(async (req,res) => {
  const { owner, q, status } = req.query;
  let sql = `SELECT p.*,u.display_name AS owner_name,u.sector AS owner_sector,u.username AS owner_username
    FROM properties p JOIN users u ON u.id=p.owner_user_id WHERE 1=1`;
  const args = [];
  if (owner) { sql += " AND u.username=?"; args.push(String(owner)); }
  if (status && ["موجود","اتباع","غير متوفر حاليا"].includes(status)) { sql += " AND p.status=?"; args.push(status); }
  if (q) { sql += " AND (p.client_name LIKE ? OR p.phone LIKE ? OR p.address LIKE ? OR p.agent_name LIKE ?)"; const v=`%${q}%`; args.push(v,v,v,v); }
  sql += " ORDER BY p.updated_at DESC,p.id DESC";
  res.json({ properties:await db.all(sql, ...args) });
}));
app.post("/api/properties", auth, asyncHandler(async (req,res) => {
  const b = req.body || {};
  const required = ["agentName","clientType","clientName","phone","address","price","propertyType"];
  if (required.some(k => b[k] === undefined || String(b[k]).trim()==="")) return res.status(400).json({error:"أكمل البيانات الأساسية المطلوبة"});
  if (!["مالك","مشتري"].includes(b.clientType) || !["شقة","عمارة","برج","منزل","أرض","محل"].includes(b.propertyType) || !["موجود","اتباع","غير متوفر حاليا"].includes(b.status || "موجود"))
    return res.status(400).json({error:"اختيار غير صحيح"});
  let ownerId = req.user.id;
  if (req.user.role === "ADMIN") {
    const target = b.ownerUsername ? await db.get("SELECT id,role FROM users WHERE username=?", String(b.ownerUsername)) : null;
    if (!target || target.role !== "LEADER") return res.status(400).json({error:"حدد شيت التيم ليدر الذي تريد إضافة العقار إليه"});
    ownerId = target.id;
  }
  const inserted = await db.get(`INSERT INTO properties(owner_user_id,agent_name,client_type,client_name,phone,address,price,area,floor,finishing,utilities,land_share,layout,property_type,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, ownerId,b.agentName,b.clientType,b.clientName,b.phone,b.address,Number(b.price),
      b.area===""||b.area==null?null:Number(b.area),b.floor||"",b.finishing||"",b.utilities||"",b.landShare||"",b.layout||"",b.propertyType,b.status||"موجود");
  res.json({ property:await db.get(`SELECT p.*,u.display_name AS owner_name,u.sector AS owner_sector,u.username AS owner_username FROM properties p JOIN users u ON u.id=p.owner_user_id WHERE p.id=?`, inserted.id) });
}));
app.put("/api/properties/:id", auth, asyncHandler(async (req,res) => {
  const p = await db.get("SELECT * FROM properties WHERE id=?", Number(req.params.id));
  if (!p) return res.status(404).json({error:"العقار غير موجود"});
  if (!canManage(req,p)) return res.status(403).json({error:"يمكنك تعديل عقارات شيتك فقط"});
  const b = req.body || {};
  if (!["مالك","مشتري"].includes(b.clientType) || !["شقة","عمارة","برج","منزل","أرض","محل"].includes(b.propertyType) || !["موجود","اتباع","غير متوفر حاليا"].includes(b.status))
    return res.status(400).json({error:"راجع نوع العميل ونوع العقار والحالة"});
  await db.run(`UPDATE properties SET agent_name=?,client_type=?,client_name=?,phone=?,address=?,price=?,area=?,floor=?,finishing=?,utilities=?,land_share=?,layout=?,property_type=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    b.agentName,b.clientType,b.clientName,b.phone,b.address,Number(b.price),b.area===""||b.area==null?null:Number(b.area),b.floor||"",b.finishing||"",b.utilities||"",b.landShare||"",b.layout||"",b.propertyType,b.status,p.id);
  res.json({ok:true});
}));
app.delete("/api/properties/:id", auth, adminOnly, asyncHandler(async (req,res) => {
  const p = await db.get("SELECT * FROM properties WHERE id=?", Number(req.params.id));
  if (!p) return res.status(404).json({error:"العقار غير موجود"});
  // Deletion is reserved exclusively for administrators.
  await db.run("DELETE FROM properties WHERE id=?", p.id);
  res.json({ok:true});
}));

// Admin-only full backup: one Excel worksheet per team leader.
app.get("/api/backup.xlsx", auth, adminOnly, async (req, res) => {
  try {
    const leaders = await db.all("SELECT id,username,display_name,sector FROM users WHERE role='LEADER' ORDER BY sector,display_name");
    const allProperties = await db.all(`
      SELECT p.*,u.display_name AS owner_name,u.sector AS owner_sector,u.username AS owner_username
      FROM properties p JOIN users u ON u.id=p.owner_user_id
      ORDER BY u.sector,u.display_name,p.updated_at DESC,p.id DESC
    `);

    const columns = [
      { header:"رقم العقار", key:"id", width:12 },
      { header:"التيم ليدر", key:"owner_name", width:20 },
      { header:"القطاع", key:"owner_sector", width:14 },
      { header:"الموظف / الوكيل", key:"agent_name", width:22 },
      { header:"نوع العميل", key:"client_type", width:14 },
      { header:"اسم المالك / المشتري", key:"client_name", width:25 },
      { header:"رقم الهاتف", key:"phone", width:18 },
      { header:"العنوان التفصيلي", key:"address", width:38 },
      { header:"السعر", key:"price", width:16 },
      { header:"المساحة م²", key:"area", width:14 },
      { header:"الدور", key:"floor", width:12 },
      { header:"التشطيب", key:"finishing", width:18 },
      { header:"المرافق والعدادات", key:"utilities", width:24 },
      { header:"نسبة الأرض", key:"land_share", width:14 },
      { header:"التقسيم", key:"layout", width:24 },
      { header:"نوع العقار", key:"property_type", width:14 },
      { header:"الحالة", key:"status", width:18 },
      { header:"تاريخ الإضافة", key:"created_at", width:22 },
      { header:"آخر تحديث", key:"updated_at", width:22 }
    ];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NASIAH Real Estate Inventory";
    workbook.created = new Date();
    const overview = workbook.addWorksheet("ملخص");
    overview.columns = [
      {header:"التيم ليدر",key:"name",width:22},
      {header:"القطاع",key:"sector",width:16},
      {header:"إجمالي العقارات",key:"total",width:20}
    ];
    for (const leader of leaders) {
      const rows = allProperties.filter(p => p.owner_user_id === leader.id);
      const sheetName = `${leader.display_name}-${leader.sector || ""}`.slice(0,31).replace(/[\\/*?:[\]]/g,"-");
      const sheet = workbook.addWorksheet(sheetName || `Leader-${leader.id}`);
      sheet.columns = columns;
      rows.forEach(row => sheet.addRow(row));
      sheet.views = [{state:"frozen", ySplit:1, rightToLeft:true}];
      sheet.autoFilter = { from: {row:1,column:1}, to: {row:1,column:columns.length} };
      sheet.getRow(1).font = {bold:true};
      sheet.getRow(1).alignment = {vertical:"middle",horizontal:"center"};
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) row.alignment = {vertical:"middle",horizontal:"right",wrapText:true};
      });
      overview.addRow({name:leader.display_name,sector:leader.sector,total:rows.length});
    }
    overview.views = [{state:"frozen",ySplit:1,rightToLeft:true}];
    overview.getRow(1).font = {bold:true};
    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0,10);
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="NASIAH-Backup-${stamp}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Backup export failed:", error);
    res.status(500).json({error:"تعذر إنشاء النسخة الاحتياطية، حاول مرة أخرى"});
  }
});

app.get("/api/stats", auth, adminOnly, asyncHandler(async (req,res) => {
  const stats = await db.all(`SELECT u.username,u.display_name AS "displayName",u.sector,
    CAST(COUNT(p.id) AS INTEGER) AS total,
    CAST(SUM(CASE WHEN p.status='موجود' THEN 1 ELSE 0 END) AS INTEGER) AS available,
    CAST(SUM(CASE WHEN p.status='اتباع' THEN 1 ELSE 0 END) AS INTEGER) AS sold,
    CAST(SUM(CASE WHEN p.status='غير متوفر حاليا' THEN 1 ELSE 0 END) AS INTEGER) AS unavailable
    FROM users u LEFT JOIN properties p ON p.owner_user_id=u.id
    WHERE u.role='LEADER' GROUP BY u.id ORDER BY u.sector`);
  res.json({stats});
}));
app.use((error, req, res, next) => {
  console.error("Request failed:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({error:"حدث خطأ داخلي"});
});
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Inventory system running on port ${PORT}`));
