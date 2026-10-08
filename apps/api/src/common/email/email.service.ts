import { Injectable, Logger } from '@nestjs/common';

export interface Email {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}

/**
 * Envio de e-mail transacional, pelo Resend.
 *
 * Por HTTP direto, sem SDK: é uma chamada só, e uma dependência a menos é
 * uma atualização de segurança a menos pra acompanhar.
 *
 * Sem `RESEND_API_KEY`, nada sai — e o sistema continua de pé. Fora de
 * produção o conteúdo vai pro log, pra dar pra testar o fluxo inteiro
 * localmente; em produção, não: o e-mail de recuperação carrega um link
 * que entra na conta, e log não é lugar pra isso.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get configurado(): boolean {
    return Boolean(process.env.RESEND_API_KEY);
  }

  async enviar(email: Email): Promise<boolean> {
    const chave = process.env.RESEND_API_KEY;
    if (!chave) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          `E-mail "${email.assunto}" não enviado: RESEND_API_KEY não configurada.`,
        );
      } else {
        this.logger.warn(
          `[sem RESEND_API_KEY] E-mail pra ${email.para} — ${email.assunto}\n${email.texto}`,
        );
      }
      return false;
    }

    try {
      const resposta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? 'Bellis <onboarding@resend.dev>',
          to: [email.para],
          subject: email.assunto,
          html: email.html,
          text: email.texto,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resposta.ok) {
        this.logger.error(
          `Resend recusou o e-mail "${email.assunto}" (${resposta.status}): ${await resposta.text()}`,
        );
        return false;
      }
      return true;
    } catch (erro) {
      this.logger.error(
        `Falha ao enviar o e-mail "${email.assunto}": ${String(erro)}`,
      );
      return false;
    }
  }
}
