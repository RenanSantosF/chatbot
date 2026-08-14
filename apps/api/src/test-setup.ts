import { Logger } from '@nestjs/common';

/**
 * Silencia o logger do Nest durante os testes.
 *
 * Os serviços registram bastante coisa de propósito — é o que permite
 * diagnosticar um envio recusado pela Meta horas depois. Mas num teste esse
 * mesmo registro afoga a saída: uma falha de asserção fica enterrada sob
 * dezenas de linhas de log de caminhos que funcionaram.
 *
 * Só o logger global é desligado. Um teste que precise conferir o que foi
 * registrado continua podendo espionar o método diretamente.
 */
Logger.overrideLogger(false);
