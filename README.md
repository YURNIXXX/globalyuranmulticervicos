# Yuran Multicerviços — Plataforma V7.0

A Yuran Multicerviços evoluiu de um portfólio multi-serviços para uma plataforma de descoberta de profissionais, serviços e projetos, com moderação, identidade, reputação, métricas e contacto direto.

## Principais módulos

- Site público responsivo com categorias, serviços, projetos e profissionais em destaque.
- Diretório de profissionais com pesquisa e filtros por categoria, localização, disponibilidade, avaliação e selo verificado.
- Perfil profissional completo com experiência, competências, idiomas, área de atendimento, CV, serviços, projetos e indicadores de confiança.
- Página própria para cada serviço profissional.
- Cadastro profissional com documento frente/verso em bucket privado.
- Login por e-mail/senha e Google OAuth.
- Painel do profissional com onboarding, notificações, avaliações, serviços, projetos e segurança.
- Moderação administrativa de perfis, documentos, serviços, projetos, avaliações e denúncias.
- Selo verificado atribuído manualmente pelo administrador e independente da aprovação documental.
- Métricas de visualização/contacto e dashboard administrativo.
- Avaliações condicionadas a uma interação de contacto registada.
- Respostas públicas do profissional às avaliações.
- Denúncias com protocolo e fluxo disciplinar.
- Retenção e eliminação automática de documentos de identidade.
- Sessões persistentes em Supabase.
- 2FA TOTP opcional para o administrador.
- Rate limiting, validação de assinatura real de uploads, Same-Origin Guard, Helmet/CSP e cookies seguros.
- Política de Privacidade, Termos de Uso, Como funciona e Central de Ajuda.
- Sitemap, robots.txt, metadados SEO e PWA básica.
- Notificações transacionais por e-mail opcionais via Resend.
- Recuperação de senha por link temporário quando o e-mail transacional estiver configurado; fallback administrativo quando não estiver.

## Instalação

Leia `INSTALACAO-V7.0.txt` antes de fazer o deploy. O arquivo `supabase-v7.0.sql` deve ser executado no Supabase **antes** de colocar o código V7.0 no Render.

## Segurança

Nunca publique no GitHub:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_RECOVERY_KEY`
- `SESSION_SECRET`
- `RESEND_API_KEY`

Esses valores pertencem exclusivamente às variáveis de ambiente do Render.
