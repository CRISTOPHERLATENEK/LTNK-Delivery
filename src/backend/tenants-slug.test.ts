import { describe, it, expect } from 'vitest';
import { problemaNoSlugTenant } from './tenants-mysql';

describe('problemaNoSlugTenant', () => {
  it('aceita slug normal', () => {
    expect(problemaNoSlugTenant('cristopher')).toBeNull();
    expect(problemaNoSlugTenant('pizzaria-da-paula')).toBeNull();
    expect(problemaNoSlugTenant('loja2')).toBeNull();
  });

  /**
   * O caso que motiva tudo: com DOMINIO_BASE ligado, o slug É um subdomínio. Um
   * tenant chamado `www` passaria a responder por www.seudominio e o site
   * principal viraria a loja dele.
   */
  it('recusa subdomínio que pertence à plataforma', () => {
    for (const s of ['www', 'api', 'admin', 'mail', 'painel', 'lojista', 'demo', 'webhook']) {
      expect(problemaNoSlugTenant(s), s).toMatch(/reservado/);
    }
  });

  it('recusa o que não é nome de host válido', () => {
    expect(problemaNoSlugTenant('-loja')).toMatch(/hífen/);
    expect(problemaNoSlugTenant('loja-')).toMatch(/hífen/);
    expect(problemaNoSlugTenant('lo--ja')).toMatch(/dois hífens/);
    expect(problemaNoSlugTenant('Loja Grande')).toMatch(/minúsculas/);
    expect(problemaNoSlugTenant('loja_grande')).toMatch(/minúsculas/);
    expect(problemaNoSlugTenant('café')).toMatch(/minúsculas/);
  });

  it('recusa curto e longo demais', () => {
    expect(problemaNoSlugTenant('a')).toMatch(/2 caracteres/);
    expect(problemaNoSlugTenant('')).toMatch(/2 caracteres/);
    expect(problemaNoSlugTenant('a'.repeat(41))).toMatch(/longo/);
  });

  it('normaliza espaço e caixa antes de julgar', () => {
    expect(problemaNoSlugTenant('  WWW  ')).toMatch(/reservado/);
    expect(problemaNoSlugTenant('  cristopher ')).toBeNull();
  });
});
