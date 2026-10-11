import db from '../database.js';
import bcrypt from 'bcryptjs';
import { User } from '../types/index.js';

export class UserRepository {
  getUsers(): User[] {
    return db.prepare('SELECT * FROM users').all() as User[];
  }

  getUserById(id: number): User | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  getUserByUsername(username: string): User | undefined {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
  }

  updateUser(id: number, username: string, passwordHash: string): void {
    db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(username, passwordHash, id);
  }

  updateUserRole(id: number, role: 'admin' | 'staff'): void {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  checkUsernameExists(username: string, excludeId?: number): boolean {
    if (excludeId) {
      return !!db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, excludeId);
    }
    return !!db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  }
}

export const userRepository = new UserRepository();
