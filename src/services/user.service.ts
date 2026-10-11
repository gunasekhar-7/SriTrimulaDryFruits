import { userRepository } from '../repositories/user.repository.js';
import bcrypt from 'bcryptjs';
import { User } from '../types/index.js';
import { auditService } from './audit.service.js';

export class UserService {
  getUsers(): User[] {
    return userRepository.getUsers();
  }

  getUserById(id: number): User | undefined {
    return userRepository.getUserById(id);
  }

  updateUser(id: number, username: string, passwordPlain?: string, role?: 'admin' | 'staff', actor = 'Admin', source = 'ADMIN_SETTINGS'): User {
    if (userRepository.checkUsernameExists(username, id)) throw new Error('Username already taken');
    const existing = userRepository.getUserById(id);
    if (!existing) throw new Error('User not found');

    if (passwordPlain && passwordPlain.trim()) {
      const hash = bcrypt.hashSync(passwordPlain, 10);
      userRepository.updateUser(id, username, hash);
    } else if (username !== existing.username) {
      userRepository.updateUser(id, username, existing.password_hash);
    }

    if (role && role !== existing.role) {
      userRepository.updateUserRole(id, role);
      auditService.recordRoleChange({
        actor,
        source,
        targetUserId: id,
        targetUsername: username,
        oldRole: existing.role,
        newRole: role
      });
    }

    return userRepository.getUserById(id)!;
  }

  updateUserRole(id: number, newRole: 'admin' | 'staff', actor = 'Admin', source = 'ADMIN_SETTINGS'): User {
    const existing = userRepository.getUserById(id);
    if (!existing) throw new Error('User not found');

    if (existing.role !== newRole) {
      userRepository.updateUserRole(id, newRole);
      auditService.recordRoleChange({
        actor,
        source,
        targetUserId: id,
        targetUsername: existing.username,
        oldRole: existing.role,
        newRole
      });
    }

    return userRepository.getUserById(id)!;
  }
}

export const userService = new UserService();
