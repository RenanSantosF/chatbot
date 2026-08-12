import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Criptografia genérica pra secrets de tenant guardados no banco — usado
 * pela API key da IA e pelas credenciais do WhatsApp. Nunca guarde
 * um secret de tenant em texto puro; sempre passe por aqui antes do
 * Prisma.create/update e depois de todo findMany/findFirst que traga o
 * campo criptografado.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY não configurada — necessária pra guardar credenciais de tenant com segurança.',
      );
    }
    // Aceita uma chave hex de 32 bytes (64 chars) pronta, ou deriva de
    // qualquer string via scrypt (mais tolerante a erro de configuração).
    this.key = /^[0-9a-f]{64}$/i.test(secret)
      ? Buffer.from(secret, 'hex')
      : scryptSync(secret, 'chatbot-saas-encryption', 32);
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, encrypted].map((buffer) => buffer.toString('base64')).join('.');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Payload criptografado em formato inválido.');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
