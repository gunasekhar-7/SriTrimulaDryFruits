import { userRepository } from '../repositories/user.repository.js';
import bcrypt from 'bcryptjs';
import { User } from '../types/index.js';

export class AuthService {
  authenticate(username: string, passwordPlain: string): User | null {
    const user = userRepository.getUserByUsername(username);
    if (user && bcrypt.compareSync(passwordPlain, user.password_hash)) {
      return user;
    }
    return null;
  }
}

export const authService = new AuthService();
