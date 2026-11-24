import Database from "better-sqlite3";
import { db as target } from "../database.js";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("../data/inventory.sqlite", import.meta.url));
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Set DATABASE_URL to the Neon connection string before migrating.");
}

const source = new Database(sourcePath, { readonly: true });

try {
  await target.init();
  const users = source.prepare("SELECT * FROM users ORDER BY id").all();
  const properties = source.prepare("SELECT * FROM properties ORDER BY id").all();
  const targetCounts = await target.get(`
    SELECT
      (SELECT COUNT(*) FROM users)::INTEGER AS users,
      (SELECT COUNT(*) FROM properties)::INTEGER AS properties
  `);
  if (targetCounts.users !== 0 || targetCounts.properties !== 0) {
    throw new Error("Neon database is not empty; migration stopped to prevent overwriting data.");
  }

  const client = await target.pool.connect();
  try {
    await client.query("BEGIN");
    for (const user of users) {
      await client.query(
        `INSERT INTO users
          (id,username,display_name,role,sector,salt,password_hash,must_change_password,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [user.id, user.username, user.display_name, user.role, user.sector, user.salt,
          user.password_hash, Boolean(user.must_change_password) || user.role === "ADMIN", user.created_at]
      );
    }

    for (const property of properties) {
      await client.query(
        `INSERT INTO properties
          (id,owner_user_id,agent_name,client_type,client_name,phone,address,price,area,floor,
           finishing,utilities,land_share,layout,property_type,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [property.id, property.owner_user_id, property.agent_name, property.client_type,
          property.client_name, property.phone, property.address, property.price, property.area,
          property.floor, property.finishing, property.utilities, property.land_share,
          property.layout, property.property_type, property.status, property.created_at, property.updated_at]
      );
    }

    await client.query(`
      SELECT setval(pg_get_serial_sequence('users','id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM users
    `);
    await client.query(`
      SELECT setval(pg_get_serial_sequence('properties','id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM properties
    `);
    await client.query("COMMIT");
    console.log(`Migrated ${users.length} user accounts and ${properties.length} properties. Active sessions were not copied.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  source.close();
  await target.close();
}
