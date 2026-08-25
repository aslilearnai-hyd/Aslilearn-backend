import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
dns.setServers(['8.8.8.8', '1.1.1.1']);

const ids = [
  '6a1a85d2f294f34784903681',
  '6a5f62b5d33b6c1fd0909258',
  '6a61fe6f6f69f8e1cfce0f56',
  '6a64aa66d2cf3230fcd5be0e',
  '6a64a98ed2cf3230fcd5bdfa',
].map((id) => new mongoose.Types.ObjectId(id));

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI/MONGODB_URI missing');
const connection = await mongoose.createConnection(uri).asPromise();
const db = connection.db;
const users = await db.collection('users').find(
  { _id: { $in: ids } },
  { projection: { fullName: 1, name: 1, schoolName: 1, organizationName: 1, email: 1 } }
).toArray();
const schools = await db.collection('schools').find({
  $or: [{ adminUserId: { $in: ids } }, { adminId: { $in: ids } }]
}).toArray();
console.log(JSON.stringify({ users, schools }, null, 2));
await connection.close();
