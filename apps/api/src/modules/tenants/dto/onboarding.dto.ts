import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * As perguntas da primeira entrada.
 *
 * Todas OPCIONAIS, e não por descuido: a tela deixa pular qualquer uma, e
 * um DTO que exigisse resposta transformaria "pular" em erro 400. Resposta
 * obrigatória aqui não traria dado melhor — traria dado inventado por quem
 * só queria passar da tela.
 *
 * Faixas em vez de números exatos no faturamento: ninguém digita o
 * faturamento real num campo aberto de um sistema que acabou de conhecer, e
 * a faixa responde igualmente bem a pergunta que interessa (que porte de
 * empresa está entrando).
 */
export class SalvarPerfilDto {
  @IsOptional()
  @IsIn(['SO_EU', 'ATE_3', 'ATE_10', 'ATE_30', 'MAIS_DE_30'])
  atendentes?: string;

  @IsOptional()
  @IsIn(['COMECANDO', 'ATE_2_ANOS', 'ATE_5_ANOS', 'ATE_10_ANOS', 'MAIS_DE_10'])
  tempoDeMercado?: string;

  @IsOptional()
  @IsIn(['ATE_20K', 'ATE_100K', 'ATE_500K', 'ACIMA_500K', 'PREFIRO_NAO_DIZER'])
  faturamento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  segmento?: string;

  /** O que a pessoa espera resolver. Texto livre curto, ótimo pra produto. */
  @IsOptional()
  @IsString()
  @MaxLength(280)
  objetivo?: string;
}
