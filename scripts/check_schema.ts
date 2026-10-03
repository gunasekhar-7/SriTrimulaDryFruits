import db from '../src/database.js';

const cols = db.prepare("PRAGMA table_info(products)").all();
console.log("Products columns:", cols.map((c: any) => c.name));

const billCols = db.prepare("PRAGMA table_info(bills)").all();
console.log("Bills columns:", billCols.map((c: any) => c.name));
