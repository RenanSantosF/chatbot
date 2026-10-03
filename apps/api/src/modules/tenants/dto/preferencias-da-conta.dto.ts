import { IsBoolean } from 'class-validator';

export class PreferenciasDaContaDto {
  /** O resumo da semana por e-mail, toda segunda. */
  @IsBoolean()
  relatorioSemanal!: boolean;
}
