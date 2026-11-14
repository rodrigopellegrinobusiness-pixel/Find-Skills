/* ===== CRM EVI Imóveis - painel interno (só usuários autorizados) ===== */

const $ = (id) => document.getElementById(id);
const sb = criarCliente();
const D = { leads: [], corretores: [], envios: [], tarefas: [], interacoes: [], digo_lancamentos: [], digo_pagamentos: [], digo_config: [], imobiliarias: [], anuncios: [] };
const filtros = { etapa: "", buscaLead: "", buscaCorretor: "", statusEnvio: "Aguardando", buscaEnvio: "" };
const TOP = 5;            // quantos corretores sugerir
const DIAS_COBRANCA = 2;  // cobrar o corretor depois de quantos dias
let aba = "tarefas";
let digoAtivo = false;   // false enquanto o banco não tiver as tabelas do Pagamentos Digo
let usuario = null;
let aberto = null;        // { tipo: "lead" | "corretor", id }
let verMais = false;      // mostrar além do top 5
let verTodosClientes = false; // ficha do corretor: mostrar todos os clientes compatíveis
let msgEditada = null;    // { leadId, texto } enquanto a janela do lead está aberta

/* No painel, o que é obrigatório só no cadastro público fica opcional. */
const paraPainel = (campos) => campos.map((c) => (c.soPublico ? { ...c, obrig: false } : c));
const CAMPOS_LEAD_PAINEL = [
  ...paraPainel(CAMPOS_LEAD),
  { id: "origem", rotulo: "Origem", tipo: "text", max: 60, dica: "Ex.: Instagram, indicação, placa" },
  { id: "captado_digo", rotulo: "Captado pelo Digo", tipo: "select", opcoes: ["Não", "Sim"] },
  { id: "etapa", rotulo: "Etapa", tipo: "select", opcoes: ETAPAS },
  { id: "observacao_interna", rotulo: "Observação interna (não vai na mensagem)", tipo: "textarea", max: 2000 },
];
const CAMPOS_CORRETOR_PAINEL = (() => {
  const base = paraPainel(CAMPOS_CORRETOR);
  const i = base.findIndex((c) => c.id === "bairro2");
  base.splice(i + 1, 0, { id: "bairro3", rotulo: "3º bairro (antigo)", tipo: "bairro", livre: true, dica: "Prefira “outros bairros”, abaixo" });
  return [...base, { id: "status", rotulo: "Situação", tipo: "select", opcoes: STATUS_CORRETOR }];
})();

/* ---------- Utilidades ---------- */
const ETAPAS_FINAIS = ["Fechado", "Pausado", "Perdido"];
const corretorPorId = (id) => D.corretores.find((c) => c.id === id);
const leadPorId = (id) => D.leads.find((l) => l.id === id);
const envioPorId = (id) => D.envios.find((e) => e.id === id);
const enviosDoLead = (id) => D.envios.filter((e) => e.lead_id === id);
const enviosDoCorretor = (id) => D.envios.filter((e) => e.corretor_id === id);
const slug = (t) => semAcento(t).replace(/[^a-z0-9]+/g, "-");
const selo = (texto) => `<span class="crm-selo crm-selo--${slug(texto)}">${escapar(texto)}</span>`;
const cobrancaVencida = (e) => e.status === "Aguardando" && e.proxima_cobranca && e.proxima_cobranca <= hojeISO();
const bairrosDe = (x) => [x.bairro1, x.bairro2, x.bairro3].filter(Boolean);

function primeiroNome(nome) {
  const p = String(nome || "").trim().split(/\s+/)[0] || "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "bom dia" : h < 18 ? "boa tarde" : "boa noite";
}
function valorLead(l) {
  const partes = [];
  if (l.valor_locacao) partes.push((l.valor_compra ? "Locação até " : "") + reais(l.valor_locacao));
  if (l.valor_compra) partes.push((l.valor_locacao ? "Compra até " : "") + reais(l.valor_compra));
  return partes.join(" | ");
}
const resumoLead = (l) => [l.operacao, l.tipo || l.categoria].filter(Boolean).join(" · ");

function mostrarTela(id) {
  ["v-config", "v-login", "v-app"].forEach((v) => $(v).classList.toggle("oculto", v !== id));
  $("menu-app").classList.toggle("oculto", id !== "v-app");
}

let temporizadorAviso;
function aviso(msg, erro = false) {
  const a = $("aviso");
  a.textContent = msg;
  a.classList.toggle("crm-toast--erro", erro);
  a.classList.add("visivel");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => a.classList.remove("visivel"), erro ? 6000 : 3000);
}

/* Executa uma gravação no banco; avisa se der erro. Devolve true se deu certo. */
async function gravar(consulta) {
  const { error } = await consulta;
  if (error) { console.error(error); aviso("Erro ao salvar: " + error.message, true); return false; }
  return true;
}
const anotar = (leadId, texto) => gravar(sb.from("interacoes").insert({ lead_id: leadId, texto, autor: usuario?.email }));

/* ---------- Mensagens (mesmo formato da planilha) ---------- */
function mensagemLead(l) {
  const metragem = l.metragem ? l.metragem + (/m²|m2|metro/i.test(l.metragem) ? "" : " m²") : "";
  const perfil = l.categoria === "Comercial"
    ? [l.tipo, metragem, l.atividade && "Atividade: " + l.atividade]
    : [l.tipo, l.dormitorios && l.dormitorios + " dorm.", metragem,
       l.vagas && (l.vagas === "Não preciso" ? "sem vaga" : l.vagas + " vaga(s)")];
  const linhas = [`${(l.operacao || "").toUpperCase()} — ${(l.tipo || l.categoria || "IMÓVEL").toUpperCase()}`];
  if (l.bairro1) linhas.push("📍 " + [l.bairro1, l.bairro2].filter(Boolean).join(" / "));
  if (valorLead(l)) linhas.push("💰 " + valorLead(l));
  if (perfil.some(Boolean)) linhas.push("🔎 " + perfil.filter(Boolean).join(" | "));
  if (l.essencial) linhas.push("✅ Essencial: " + l.essencial);
  if (l.diferencial) linhas.push("⭐ Seria um diferencial: " + l.diferencial);
  if (l.prazo) linhas.push(`⏱️ ${l.prazo} para mudança`);
  linhas.push("🤝 Parceria");
  return linhas.join("\n");
}
const textoEnvio = (corretor, corpo) =>
  `Oi, ${primeiroNome(corretor.nome)}, ${saudacao()}. Tudo certo? Estou com um cliente dentro da sua área de atuação. ` +
  `Você tem algum imóvel no perfil que ele está procurando?\n\n${corpo}`;
const textoCobranca = (corretor, lead) =>
  `Oi, ${primeiroNome(corretor.nome)}, ${saudacao()}. Tudo certo? Conseguiu ver algum imóvel para aquele cliente que te enviei?\n\n` +
  mensagemLead(lead).split("\n").slice(0, 3).join("\n");

/* ---------- Match lead x corretor (mesmas regras da planilha) ---------- */
/* Bairros extras do corretor: os que ele marcou (ou o 3º bairro) e os que citou nas observações. */
function extrasDe(c) {
  const principais = [c.bairro1, c.bairro2].map(semAcento);
  const novo = (lista, ja = []) => [...new Set(lista.filter(Boolean))].filter((b) => !principais.includes(semAcento(b)) && !ja.map(semAcento).includes(semAcento(b)));
  const marcados = novo([c.bairro3, ...(c.outros_bairros || [])]);
  const citados = novo(bairrosCitados(c.observacoes), marcados);
  return { marcados, citados, zonas: zonasCitadas(c.observacoes) };
}
const todosBairros = (c) => { const x = extrasDe(c); return [...new Set([c.bairro1, c.bairro2, ...x.marcados, ...x.citados].filter(Boolean))]; };

function pontuar(lead, c) {
  const principais = [c.bairro1, c.bairro2].map(semAcento);
  const extras = extrasDe(c);
  const minhasZonas = [...todosBairros(c).map(zonaDe), ...extras.zonas].filter(Boolean);
  const notas = []; // explica quando o corretor entrou por um bairro extra
  // pontos: [1º bairro do corretor, 2º bairro, bairro extra], depois só a zona
  const parte = (bairro, pontos, pontosZona) => {
    if (!bairro) return 0;
    const alvo = semAcento(bairro);
    const i = principais.indexOf(alvo);
    if (i >= 0) return pontos[i];
    if (extras.marcados.some((b) => semAcento(b) === alvo)) { notas.push(`também atua em ${bairro}`); return pontos[2]; }
    if (extras.citados.some((b) => semAcento(b) === alvo)) { notas.push(`${bairro} citado nas observações`); return pontos[2]; }
    const z = zonaDe(bairro);
    return z && minhasZonas.includes(z) ? pontosZona : 0;
  };
  const regiao = parte(lead.bairro1, [50, 40, 30], 5) + parte(lead.bairro2, [25, 20, 15], 3);

  const categoriaOk = c.categoria === lead.categoria || c.categoria === "Ambos";
  const operacaoOk = lead.operacao === "Compra ou locação" || c.operacao === "Ambos" ||
    (lead.operacao === "Compra" && c.operacao === "Venda") || (lead.operacao === "Locação" && c.operacao === "Locação");
  if (c.status !== "Ativo" || regiao === 0 || !categoriaOk || !operacaoOk) return null;

  // Faixa de valor: +15 se o orçamento cabe numa faixa do corretor, -15 se não cabe, 0 se ele não informou.
  const valor = lead.operacao === "Locação" ? lead.valor_locacao : lead.operacao === "Compra" ? lead.valor_compra : 0;
  const limites = ((lead.operacao === "Locação" ? c.faixas_locacao : c.faixas_venda) || []).map((f) => LIMITES_FAIXA[f]).filter(Boolean);
  let faixa = "";
  if (valor && limites.length) faixa = limites.some(([min, max]) => valor >= min && valor <= max) ? "Dentro" : "Fora";
  const bonus = faixa === "Dentro" ? 15 : faixa === "Fora" ? -15 : 0;

  // Especialidades: somam pontos quando combinam com o pedido do cliente.
  const esp = c.especialidades || [];
  const tem = (e) => esp.includes(e);
  const vl = lead.valor_locacao || 0, vc = lead.valor_compra || 0;
  const combinam = [];
  if (tem("Alto padrão") && (vl >= ALTO_PADRAO.locacao || vc >= ALTO_PADRAO.compra)) combinam.push("alto padrão");
  if (tem("Econômico / MCMV") && ((vl && vl <= ECONOMICO.locacao) || (vc && vc <= ECONOMICO.compra))) combinam.push("econômico");
  if (tem("Terrenos") && lead.tipo === "Terreno") combinam.push("terrenos");
  if (tem("Galpões") && lead.tipo === "Galpão") combinam.push("galpões");
  if (tem("Lojas e salas") && ["Loja", "Sala/Conjunto Comercial"].includes(lead.tipo)) combinam.push("lojas e salas");
  if (tem("Studios") && lead.tipo === "Studio") combinam.push("studios");
  if (combinam.length) notas.push("especialista em " + combinam.join(" e "));
  const bonusEsp = combinam.length * PONTOS_ESPECIALIDADE;

  const nivel = regiao >= 50 ? "Excelente" : regiao >= 30 ? "Boa" : "Possível";
  const compat = nivel + (faixa === "Dentro" ? " · na faixa ✓" : faixa === "Fora" ? " · fora da faixa" : "");
  return { c, score: regiao + bonus + bonusEsp, nivel, compat, notas: [...new Set(notas)] };
}

function rankear(lead) {
  return D.corretores.map((c) => pontuar(lead, c)).filter(Boolean)
    .map((r) => ({ ...r, recebidos: enviosDoCorretor(r.c.id).length }))
    .sort((a, b) => b.score - a.score || a.recebidos - b.recebidos || a.c.nome.localeCompare(b.c.nome, "pt-BR"));
}

/* ---------- Login ---------- */
async function iniciar() {
  if (!sb) { mostrarTela("v-config"); return; }
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar(data.session.user);
  else mostrarTela("v-login");
}

async function entrar(user) {
  const { data: autorizado, error } = await sb.rpc("is_crm_admin");
  if (error || !autorizado) {
    await sb.auth.signOut();
    mostrarTela("v-login");
    erroLogin(error ? "Não foi possível verificar seu acesso. Tente de novo." : "Esta conta não tem acesso ao painel.");
    return;
  }
  usuario = user;
  mostrarTela("v-app");
  await carregar();
}

function erroLogin(msg) {
  $("erro-login").textContent = msg;
  $("erro-login").classList.remove("oculto");
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erro-login").classList.add("oculto");
  const f = e.target;
  const botao = f.querySelector("button");
  botao.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: f.elements.email.value.trim(), password: f.elements.senha.value });
  botao.disabled = false;
  if (error) { erroLogin("E-mail ou senha incorretos."); return; }
  f.reset();
  await entrar(data.user);
});

/* ---------- Dados ---------- */
async function carregar() {
  const tabelas = Object.keys(D);
  const respostas = await Promise.all(tabelas.map((t) => sb.from(t).select("*").order("criado_em", { ascending: false })));
  // Tabelas do Pagamentos Digo são opcionais: se ainda não existirem no banco, o resto do painel segue normal.
  digoAtivo = !tabelas.some((t, i) => t.startsWith("digo_") && respostas[i].error);
  tabelas.forEach((t, i) => { if (t.startsWith("digo_") && respostas[i].error) respostas[i] = { data: [] }; });
  // Tabela de imobiliárias também é opcional: sem ela, a aba funciona só com o que vem dos corretores.
  const iImob = tabelas.indexOf("imobiliarias");
  imobAtivo = !respostas[iImob].error;
  if (!imobAtivo) respostas[iImob] = { data: [] };
  const iAnun = tabelas.indexOf("anuncios");
  anunciosAtivo = !respostas[iAnun].error;
  if (!anunciosAtivo) respostas[iAnun] = { data: [] };
  const falha = respostas.find((r) => r.error);
  if (falha) { console.error(falha.error); aviso("Erro ao carregar dados: " + falha.error.message, true); return; }
  tabelas.forEach((t, i) => { D[t] = respostas[i].data || []; });
  desenhar();
  if (aberto) reabrirJanela();
}

/* ---------- Abas ---------- */
function desenhar() {
  const hoje = hojeISO();
  const novos = D.leads.filter((l) => l.etapa === "Novo").length;
  $("n-leads").textContent = novos ? `${novos} novo${novos > 1 ? "s" : ""}` : "";
  $("n-corretores").textContent = D.corretores.filter((c) => c.status === "Ativo").length;
  const pend = D.envios.filter(cobrancaVencida).length + D.tarefas.filter((t) => t.lead_id && !t.concluida && t.vence_em && t.vence_em <= hoje).length;
  atualizarContadorTarefas();
  $("n-envios").textContent = pend ? `${pend} a cobrar` : "";
  $("n-envios").classList.toggle("crm-aba__n--alerta", pend > 0);
  const saldoDigo = resumoDigo().saldo;
  $("n-digo").textContent = saldoDigo > 0 ? brl(saldoDigo).replace(",00", "") : "";
  $("n-imobiliarias").textContent = gruposImob().length || "";
  const vencendo = (D.anuncios || []).filter((a) => a.status === "Ativo" && diasAte(a.expira_em) >= 0 && diasAte(a.expira_em) <= 3).length;
  $("n-anuncios").textContent = vencendo ? `${vencendo} vencendo` : ((D.anuncios || []).filter((a) => a.status === "Ativo" && diasAte(a.expira_em) >= 0).length || "");
  $("n-anuncios").classList.toggle("crm-aba__n--alerta", vencendo > 0);
  document.querySelectorAll(".crm-aba[data-aba]").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  // No celular a barra de abas rola para o lado: mantém a aba escolhida à vista.
  document.querySelector(".crm-aba.ativa")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  ({ leads: abaLeads, tarefas: abaTarefas, corretores: abaCorretores, imobiliarias: abaImobiliarias, anuncios: abaAnuncios, envios: abaEnvios, relatorios: abaRelatorios, digo: abaDigo })[aba]();
}

/* ----- Leads ----- */
function abaLeads() {
  $("conteudo").innerHTML = `
    <div class="crm-barra">
      <input type="search" id="busca-lead" placeholder="Buscar por nome, telefone, bairro..." value="${escapar(filtros.buscaLead)}">
      <select id="filtro-etapa">${htmlOpcoes(ETAPAS, filtros.etapa, "Todas as etapas")}</select>
      <button class="botao botao--zap" data-acao="novo-lead">+ Novo lead</button>
    </div>
    <div id="lista"></div>`;
  listaLeads();
}

function listaLeads() {
  const termo = semAcento(filtros.buscaLead);
  const itens = D.leads.filter((l) =>
    (!filtros.etapa || l.etapa === filtros.etapa) &&
    (!termo || semAcento([l.nome, l.telefone, l.bairro1, l.bairro2, l.tipo, l.categoria, l.origem].join(" ")).includes(termo)));
  if (!itens.length) {
    $("lista").innerHTML = `<p class="vazio">${D.leads.length ? "Nenhum lead com esses filtros." : "Nenhum lead ainda. Envie o link de cadastro ou clique em “+ Novo lead”."}</p>`;
    return;
  }
  $("lista").innerHTML = `<div class="crm-tabela-wrap"><table class="crm-tabela">
    <thead><tr><th>Cliente</th><th>Procura</th><th>Bairros</th><th>Valor máx.</th><th>Etapa</th><th>Enviado para</th><th>Entrada</th><th class="crm-col-mais"><span class="crm-so-leitor">Ações</span></th></tr></thead>
    <tbody>${itens.map((l) => {
      const env = enviosDoLead(l.id);
      const nomes = env.map((e) => primeiroNome(corretorPorId(e.corretor_id)?.nome)).filter(Boolean);
      return `<tr data-acao="abrir-lead" data-id="${l.id}" tabindex="0">
        <td><strong>${escapar(l.nome)}</strong><small>${escapar(formatarTelefone(l.telefone))}</small></td>
        <td>${escapar(resumoLead(l))}<small>${escapar(l.categoria || "")}</small></td>
        <td>${escapar([l.bairro1, l.bairro2].filter(Boolean).join(" / ") || "—")}</td>
        <td>${escapar(valorLead(l) || "—")}</td>
        <td>${selo(l.etapa)}</td>
        <td>${env.length ? `${env.length} corretor(es)<small>${escapar(nomes.join(", "))}</small>` : '<span class="crm-pendente">Não enviado</span>'}</td>
        <td>${dataBR(l.criado_em)}<small>${escapar(l.origem || "")}</small></td>
        <td class="crm-col-mais">${botaoMais("lead", l.id, l.nome)}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

/* ----- Corretores ----- */
function abaCorretores() {
  $("conteudo").innerHTML = `
    <div class="crm-barra">
      <input type="search" id="busca-corretor" placeholder="Buscar por nome, bairro, imobiliária..." value="${escapar(filtros.buscaCorretor)}">
      <button class="botao botao--zap" data-acao="novo-corretor">+ Novo corretor</button>
    </div>
    <div id="lista"></div>`;
  listaCorretores();
}

function listaCorretores() {
  const termo = semAcento(filtros.buscaCorretor);
  const itens = D.corretores.filter((c) =>
    !termo || semAcento([c.nome, c.telefone, c.imobiliaria, c.creci, ...todosBairros(c), ...(c.especialidades || [])].join(" ")).includes(termo));
  if (!itens.length) {
    $("lista").innerHTML = `<p class="vazio">${D.corretores.length ? "Nenhum corretor encontrado." : "Nenhum corretor ainda. Envie o link de cadastro ou clique em “+ Novo corretor”."}</p>`;
    return;
  }
  const vezes = {};
  D.corretores.forEach((c) => { const k = soDigitos(c.telefone).slice(-8); vezes[k] = (vezes[k] || 0) + 1; });
  $("lista").innerHTML = `<div class="crm-tabela-wrap"><table class="crm-tabela">
    <thead><tr><th>Corretor</th><th>Bairros</th><th>Atende</th><th>Faixas</th><th>Leads recebidos</th><th>Situação</th><th class="crm-col-mais"><span class="crm-so-leitor">Ações</span></th></tr></thead>
    <tbody>${itens.map((c) => `<tr data-acao="abrir-corretor" data-id="${c.id}" tabindex="0">
        <td><strong>${escapar(c.nome)}</strong><small>${escapar([formatarTelefone(c.telefone), c.imobiliaria].filter(Boolean).join(" · "))}</small>
          ${vezes[soDigitos(c.telefone).slice(-8)] > 1 ? '<small class="crm-pendente">⚠ telefone repetido em outro cadastro</small>' : ""}</td>
        <td>${escapar([c.bairro1, c.bairro2].filter(Boolean).join(" / ") || "—")}${todosBairros(c).length > 2 ? ` <span class="crm-mais-bairros" title="${escapar(todosBairros(c).slice(2).join(", "))}">+${todosBairros(c).length - 2}</span>` : ""}<small>${escapar([...new Set(todosBairros(c).map(zonaDe).filter(Boolean))].join(" · "))}</small></td>
        <td>${escapar(c.categoria)}<small>${escapar(c.operacao)}</small></td>
        <td><small>${escapar([...(c.faixas_locacao || []), ...(c.faixas_venda || [])].join(", ") || "Não informou")}</small></td>
        <td>${enviosDoCorretor(c.id).length}</td>
        <td>${selo(c.status)}</td>
        <td class="crm-col-mais">${botaoMais("corretor", c.id, c.nome)}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

/* ----- Envios e cobranças ----- */
function itemEnvio(e, mostrar) {
  const l = leadPorId(e.lead_id);
  const c = corretorPorId(e.corretor_id);
  if (!l || !c) return "";
  const vencida = cobrancaVencida(e);
  const titulo = [
    mostrar.corretor && `<button class="crm-link-texto" data-acao="abrir-corretor" data-id="${c.id}">${escapar(c.nome)}</button>`,
    mostrar.lead && `<button class="crm-link-texto" data-acao="abrir-lead" data-id="${l.id}">${escapar(l.nome)}</button>`,
  ].filter(Boolean).join(" ← ");
  return `<li class="crm-envio${vencida ? " vencida" : ""}">
    <div class="crm-envio__topo">
      <strong>${titulo}</strong>
      <small>Enviado em ${dataBR(e.criado_em)}${e.cobrado_em ? " · cobrado em " + dataBR(e.cobrado_em) : ""}${vencida ? " · <b>cobrar agora</b>" : ""}</small>
    </div>
    <div class="crm-envio__campos">
      <label>Status<select data-acao="envio-status" data-id="${e.id}">${htmlOpcoes(STATUS_ENVIO, e.status)}</select></label>
      <label class="crm-envio__retorno">Retorno do corretor<input type="text" data-acao="envio-retorno" data-id="${e.id}" value="${escapar(e.retorno)}" maxlength="1000" placeholder="O que ele respondeu"></label>
      <label>Próxima cobrança<input type="date" data-acao="envio-cobranca" data-id="${e.id}" value="${escapar(e.proxima_cobranca || "")}"></label>
      <a class="botao botao--whats" data-acao="cobrar" data-id="${e.id}" href="${linkWhatsApp(c.telefone, textoCobranca(c, l))}" target="_blank" rel="noopener">Cobrar</a>
      <button class="crm-x" data-acao="excluir-envio" data-id="${e.id}" aria-label="Excluir envio">×</button>
    </div>
  </li>`;
}

function itemTarefa(t, comLead = true) {
  const l = leadPorId(t.lead_id);
  const hoje = hojeISO();
  const classe = t.concluida ? "feita" : t.vence_em < hoje ? "atrasada" : t.vence_em === hoje ? "hoje" : "";
  const rotulo = t.concluida ? "" : t.vence_em < hoje ? " · atrasado" : t.vence_em === hoje ? " · hoje" : "";
  return `<li class="crm-tarefa ${classe}">
    <input type="checkbox" data-acao="concluir-tarefa" data-id="${t.id}"${t.concluida ? " checked" : ""} aria-label="Concluir">
    <div>
      <strong>${escapar(t.descricao)}</strong>
      <small>${dataBR(t.vence_em)}${rotulo}${comLead && l ? ` · <button class="crm-link-texto" data-acao="abrir-lead" data-id="${l.id}">${escapar(l.nome)}</button>` : ""}</small>
    </div>
    <button class="crm-x" data-acao="excluir-tarefa" data-id="${t.id}" aria-label="Excluir lembrete">×</button>
  </li>`;
}

function abaEnvios() {
  const tarefas = D.tarefas.filter((t) => t.lead_id && !t.concluida).sort((a, b) => (a.vence_em || "9999").localeCompare(b.vence_em || "9999"));
  $("conteudo").innerHTML = `
    <h2 class="crm-titulo">Leads enviados a corretores</h2>
    <div class="crm-barra crm-barra--busca">
      <label class="crm-busca">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 0 3.7 10.7l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg>
        <span class="crm-so-leitor">Pesquisar envios</span>
        <input type="search" id="busca-envio" placeholder="Pesquisar pelo nome do corretor, telefone ou cliente..." value="${escapar(filtros.buscaEnvio)}" autocomplete="off">
      </label>
      <select id="filtro-envio" aria-label="Filtrar por status">${htmlOpcoes(STATUS_ENVIO, filtros.statusEnvio, "Todos os status")}</select>
    </div>
    <div id="lista-envios"></div>
    ${tarefas.length ? `<h2 class="crm-titulo">Lembretes pendentes</h2><ul class="crm-tarefas">${tarefas.map((t) => itemTarefa(t)).join("")}</ul>` : ""}`;
  listaEnvios();
}

/* Lista de envios, filtrada pelo status e pela pesquisa (corretor, telefone ou cliente). */
function listaEnvios() {
  const termo = semAcento(filtros.buscaEnvio);
  const digitos = soDigitos(filtros.buscaEnvio);
  const bate = (e) => {
    if (!termo) return true;
    const c = corretorPorId(e.corretor_id);
    const l = leadPorId(e.lead_id);
    if (semAcento([c?.nome, c?.imobiliaria, l?.nome].join(" ")).includes(termo)) return true;
    // Telefone: compara só os números, para achar com ou sem parênteses e traço.
    return digitos.length >= 3 && soDigitos(c?.telefone).includes(digitos);
  };
  const lista = D.envios.filter((e) => (!filtros.statusEnvio || e.status === filtros.statusEnvio) && bate(e))
    .sort((a, b) => (a.proxima_cobranca || "9999").localeCompare(b.proxima_cobranca || "9999"));
  const emOutros = termo && filtros.statusEnvio ? D.envios.filter((e) => e.status !== filtros.statusEnvio && bate(e)).length : 0;
  const dica = emOutros ? ` <button class="crm-link-texto" data-acao="envios-todos-status">Ver também ${emOutros} em outros status</button>` : "";
  let vazio = "Nenhum envio ainda. Abra um lead e clique em “📲 Enviar” ao lado de um corretor.";
  if (D.envios.length) vazio = termo ? `Nenhum envio encontrado para “${escapar(filtros.buscaEnvio)}”${filtros.statusEnvio ? " com esse status" : ""}.` : "Nenhum envio com esse status.";
  $("lista-envios").innerHTML =
    (termo ? `<p class="resultado">${lista.length} envio(s) encontrado(s).${dica}</p>` : "") +
    (lista.length ? `<ul class="crm-envios">${lista.map((e) => itemEnvio(e, { corretor: true, lead: true })).join("")}</ul>`
      : `<p class="vazio">${vazio}${termo ? dica : ""}</p>`);
}

/* ----- Relatórios ----- */
function barras(titulo, pares) {
  const max = Math.max(1, ...pares.map(([, n]) => n));
  const linhas = pares.length
    ? pares.map(([nome, n]) => `<div class="crm-barra-linha"><span>${escapar(nome)}</span>
        <div class="crm-barra-trilho"><div style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`).join("")
    : '<p class="crm-sem-dados">Sem dados ainda.</p>';
  return `<section class="crm-cartao"><h3>${escapar(titulo)}</h3>${linhas}</section>`;
}

function contar(valores) {
  const m = new Map();
  valores.forEach((k) => { if (k) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function abaRelatorios() {
  const ativos = D.corretores.filter((c) => c.status === "Ativo");
  const limite30 = Date.now() - 30 * 864e5;
  const enviados = new Set(D.envios.map((e) => e.lead_id));
  const naoEnviados = D.leads.filter((l) => !enviados.has(l.id) && !ETAPAS_FINAIS.includes(l.etapa));
  const numero = (rotulo, valor) => `<div class="crm-numero"><b>${valor}</b><span>${rotulo}</span></div>`;

  const cobertura = Object.keys(NOME_ZONA).map((z) => {
    const nLeads = D.leads.filter((l) => [l.bairro1, l.bairro2].some((b) => zonaDe(b) === z)).length;
    const nCorr = ativos.filter((c) => todosBairros(c).some((b) => zonaDe(b) === z) || extrasDe(c).zonas.includes(z)).length;
    const situacao = nCorr === 0 ? (nLeads > 0 ? "🔴 Sem corretor" : "—") : nLeads > nCorr ? "🟡 Recrutar mais" : "🟢 OK";
    return `<tr><td>${NOME_ZONA[z]}</td><td>${nLeads}</td><td>${nCorr}</td><td>${situacao}</td></tr>`;
  }).join("");

  $("conteudo").innerHTML = `
    <div class="crm-numeros">
      ${numero("Leads recebidos", D.leads.length)}
      ${numero("Nos últimos 30 dias", D.leads.filter((l) => new Date(l.criado_em).getTime() >= limite30).length)}
      ${numero("Residenciais", D.leads.filter((l) => l.categoria === "Residencial").length)}
      ${numero("Comerciais", D.leads.filter((l) => l.categoria === "Comercial").length)}
      ${numero("Enviados a corretores", enviados.size)}
      ${numero("Negócios fechados", D.leads.filter((l) => l.etapa === "Fechado").length)}
      ${numero("Corretores ativos", ativos.length)}
      ${numero("Cobranças vencidas", D.envios.filter(cobrancaVencida).length)}
    </div>
    <div class="crm-grade-cartoes">
      <section class="crm-cartao"><h3>Cobertura por zona</h3>
        <table class="crm-mini"><thead><tr><th>Zona</th><th>Leads</th><th>Corretores</th><th>Situação</th></tr></thead><tbody>${cobertura}</tbody></table>
      </section>
      <section class="crm-cartao"><h3>Leads ainda não enviados (${naoEnviados.length})</h3>
        ${naoEnviados.length ? `<ul class="crm-lista-simples">${naoEnviados.slice(0, 12).map((l) =>
          `<li><button class="crm-link-texto" data-acao="abrir-lead" data-id="${l.id}">${escapar(l.nome)}</button> <small>${escapar(l.bairro1 || "")}</small></li>`).join("")}</ul>`
          : '<p class="crm-sem-dados">Todos enviados ✅</p>'}
      </section>
      ${barras("Leads por etapa", ETAPAS.map((e) => [e, D.leads.filter((l) => l.etapa === e).length]))}
      ${barras("Bairros mais pedidos", contar(D.leads.flatMap((l) => [l.bairro1, l.bairro2])).slice(0, 10))}
      ${barras("Bairros com corretores ativos", contar(ativos.flatMap(todosBairros)).slice(0, 10))}
      ${barras("Leads por origem", contar(D.leads.map((l) => l.origem)))}
      ${barras("Envios por status", STATUS_ENVIO.map((s) => [s, D.envios.filter((e) => e.status === s).length]))}
      ${barras("Corretores que mais receberam leads", contar(D.envios.map((e) => corretorPorId(e.corretor_id)?.nome)).slice(0, 10))}
    </div>`;
}

/* ---------- Janela (detalhes e formulários) ---------- */
function abrirJanela(html) {
  $("janela-conteudo").innerHTML = html;
  if (!$("janela").open) $("janela").showModal();
  $("janela").scrollTop = 0;
}
function fecharJanela() { aberto = null; if ($("janela").open) $("janela").close(); }
function reabrirJanela() {
  if (!aberto || !$("janela").open || aberto.tipo === "anuncio") return;
  const topo = $("janela").scrollTop;
  if (aberto.tipo === "lead") janelaLead(aberto.id);
  else if (aberto.tipo === "imobiliaria") janelaImob(aberto.id);
  else janelaCorretor(aberto.id);
  $("janela").scrollTop = topo;
}
const info = (rotulo, valor) => (valor ? `<div><dt>${rotulo}</dt><dd>${valor}</dd></div>` : "");

function janelaLead(id) {
  const l = leadPorId(id);
  if (!l) { fecharJanela(); return; }
  if (!aberto || aberto.id !== id) { verMais = false; msgEditada = null; }
  aberto = { tipo: "lead", id };
  const corpo = msgEditada?.leadId === id ? msgEditada.texto : mensagemLead(l);
  const ranking = rankear(l);
  const visiveis = verMais ? ranking : ranking.slice(0, TOP);
  const envios = enviosDoLead(id);
  const jaEnviado = (cid) => envios.find((e) => e.corretor_id === cid);
  const tarefas = D.tarefas.filter((t) => t.lead_id === id).sort((a, b) => a.concluida - b.concluida || (a.vence_em || "9999").localeCompare(b.vence_em || "9999"));
  const historico = D.interacoes.filter((i) => i.lead_id === id);
  const zonas = [...new Set([l.bairro1, l.bairro2].map(zonaDe).filter(Boolean))].map((z) => NOME_ZONA[z]).join(" / ");

  const linhaRanking = (r, i) => {
    const env = jaEnviado(r.c.id);
    return `<li class="crm-sugestao${env ? " crm-sugestao--atual" : ""}">
      <span class="crm-rank">${i + 1}</span>
      <div>
        <strong>${escapar(r.c.nome)}</strong> <span class="crm-score">${r.score} pts</span>
        <small>${escapar([r.c.bairro1, r.c.bairro2].filter(Boolean).join(" / "))}${r.c.imobiliaria ? " · " + escapar(r.c.imobiliaria) : ""}</small>
        ${r.notas.length ? `<small class="crm-nota-extra">↳ ${escapar(r.notas.join(" · "))}</small>` : ""}
        <small><b class="crm-nivel crm-nivel--${slug(r.nivel)}">${escapar(r.compat)}</b> · já recebeu ${r.recebidos} lead(s)${env ? ` · <b>enviado em ${dataBR(env.criado_em)}</b>` : ""}</small>
      </div>
      <div class="crm-sugestao__acoes">
        <a class="botao botao--whats" data-acao="enviar" data-corretor="${r.c.id}" href="${linkWhatsApp(r.c.telefone, textoEnvio(r.c, corpo))}" target="_blank" rel="noopener">📲 ${env ? "Reenviar" : "Enviar"}</a>
      </div></li>`;
  };

  abrirJanela(`<div class="crm-janela__corpo">
    <header class="crm-janela__topo">
      <div><h2>${escapar(l.nome)}</h2><p>${escapar(resumoLead(l))} · entrou em ${dataBR(l.criado_em)}</p></div>
      <label class="crm-campo crm-campo--etapa">Etapa<select data-acao="mudar-etapa">${htmlOpcoes(ETAPAS, l.etapa)}</select></label>
    </header>

    <dl class="crm-info">
      ${info("WhatsApp", `<a href="${linkWhatsApp(l.telefone)}" target="_blank" rel="noopener">${escapar(formatarTelefone(l.telefone))}</a>`)}
      ${info("Bairros", escapar([l.bairro1, l.bairro2].filter(Boolean).join(" / ")))}
      ${info("Zonas", escapar(zonas))}
      ${info("Orçamento", escapar(valorLead(l)))}
      ${info("Categoria", escapar(l.categoria))}
      ${info("Origem", escapar(l.origem))}
      ${info("Observação interna", escapar(l.observacao_interna))}
    </dl>
    <div class="crm-acoes">
      <button class="botao botao--detalhes" data-acao="editar-lead">Editar dados</button>
      <button class="botao crm-perigo" data-acao="excluir-lead">Excluir lead</button>
    </div>

    <h3>Mensagem pronta para encaminhar</h3>
    <textarea id="msg-texto" rows="9" aria-label="Mensagem para os corretores">${escapar(corpo)}</textarea>
    <p class="crm-aviso-legal">Pode ajustar o texto antes de enviar. O contato do cliente não vai na mensagem. A saudação (“Oi, Fulano, ${saudacao()}…”) é colocada sozinha.
      <button class="crm-link-texto" data-acao="copiar-msg">Copiar texto</button></p>

    <h3>Top ${TOP} corretores para este lead</h3>
    ${visiveis.length ? `<ol class="crm-sugestoes">${visiveis.map(linhaRanking).join("")}</ol>`
      : '<p class="crm-sem-dados">Nenhum corretor ativo atende esses bairros, categoria e operação. Cadastre um corretor ou revise os bairros do lead.</p>'}
    ${ranking.length > TOP ? `<button class="crm-link-texto" data-acao="ver-mais">${verMais ? "Mostrar só os 5 melhores" : `Ver os outros ${ranking.length - TOP} corretores compatíveis`}</button>` : ""}

    <h3>Envios deste lead (${envios.length})</h3>
    ${envios.length ? `<ul class="crm-envios">${envios.map((e) => itemEnvio(e, { corretor: true })).join("")}</ul>`
      : '<p class="crm-sem-dados">Ainda não foi enviado a nenhum corretor.</p>'}

    <h3>Lembretes</h3>
    ${tarefas.length ? `<ul class="crm-tarefas">${tarefas.map((t) => itemTarefa(t, false)).join("")}</ul>` : ""}
    <form class="crm-linha-form" data-form="tarefa">
      <input type="text" name="descricao" placeholder="Ex.: ligar para o cliente" maxlength="500" required>
      <input type="date" name="vence_em" value="${hojeISO()}" required>
      <button class="botao botao--zap">Adicionar</button>
    </form>

    <h3>Histórico</h3>
    <form class="crm-linha-form" data-form="nota">
      <input type="text" name="texto" placeholder="Anotar um contato ou observação" maxlength="2000" required>
      <button class="botao botao--zap">Anotar</button>
    </form>
    ${historico.length ? `<ul class="crm-historico">${historico.map((i) =>
      `<li><small>${new Date(i.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${i.autor ? " · " + escapar(i.autor) : ""}</small>${escapar(i.texto)}</li>`).join("")}</ul>`
      : '<p class="crm-sem-dados">Nada anotado ainda.</p>'}
  </div>`);
}

/* Clientes em andamento que combinam com o corretor (mesma conta do match, ao contrário). */
function clientesCompativeis(c) {
  const comoAtivo = { ...c, status: "Ativo" }; // corretor pausado: mostra mesmo assim, com aviso
  return D.leads.filter((l) => !ETAPAS_FINAIS.includes(l.etapa))
    .map((l) => ({ l, r: pontuar(l, comoAtivo), env: enviosDoLead(l.id).find((e) => e.corretor_id === c.id) }))
    .filter((x) => x.r)
    .sort((a, b) => b.r.score - a.r.score || (a.l.criado_em < b.l.criado_em ? 1 : -1));
}

function htmlClientesCompativeis(c) {
  const lista = clientesCompativeis(c);
  const LIMITE = 10;
  const visiveis = verTodosClientes ? lista : lista.slice(0, LIMITE);
  const pausado = c.status !== "Ativo"
    ? `<p class="crm-aviso-banco">Este corretor está <b>${escapar(c.status)}</b>: ele não aparece nas sugestões dos clientes enquanto estiver assim.</p>` : "";
  if (!lista.length) return `${pausado}<p class="crm-sem-dados">Nenhum cliente em andamento combina com os bairros, a categoria e a operação deste corretor.</p>`;
  return `${pausado}<ol class="crm-sugestoes">${visiveis.map(({ l, r, env }, i) => `<li class="crm-sugestao${env ? " crm-sugestao--atual" : ""}">
      <span class="crm-rank">${i + 1}</span>
      <div>
        <strong>${escapar(l.nome)}</strong> <span class="crm-score">${r.score} pts</span>
        <small>${escapar([resumoLead(l), [l.bairro1, l.bairro2].filter(Boolean).join(" / "), valorLead(l)].filter(Boolean).join(" · "))}</small>
        ${r.notas.length ? `<small class="crm-nota-extra">↳ ${escapar(r.notas.join(" · "))}</small>` : ""}
        <small><b class="crm-nivel crm-nivel--${slug(r.nivel)}">${escapar(r.compat)}</b> · ${selo(l.etapa)}${env ? ` · <b>já enviado em ${dataBR(env.criado_em)}</b>` : ""}</small>
      </div>
      <div class="crm-sugestao__acoes">
        <button class="botao botao--detalhes" data-acao="abrir-lead" data-id="${l.id}">Abrir</button>
        <a class="botao botao--whats" data-acao="enviar-cliente" data-lead="${l.id}" data-corretor="${c.id}" href="${linkWhatsApp(c.telefone, textoEnvio(c, mensagemLead(l)))}" target="_blank" rel="noopener">📲 ${env ? "Reenviar" : "Enviar"}</a>
      </div></li>`).join("")}</ol>
    ${lista.length > LIMITE ? `<button class="crm-link-texto" data-acao="ver-todos-clientes">${verTodosClientes ? `Mostrar só os ${LIMITE} melhores` : `Ver todos os ${lista.length} clientes compatíveis`}</button>` : ""}`;
}

function janelaCorretor(id) {
  const c = corretorPorId(id);
  if (!c) { fecharJanela(); return; }
  if (!aberto || aberto.tipo !== "corretor" || aberto.id !== id) verTodosClientes = false;
  aberto = { tipo: "corretor", id };
  const envios = enviosDoCorretor(id);
  const extras = extrasDe(c);
  const zonas = [...new Set([...todosBairros(c).map(zonaDe), ...extras.zonas].filter(Boolean))].map((z) => NOME_ZONA[z]).join(" / ");
  abrirJanela(`<div class="crm-janela__corpo">
    <header class="crm-janela__topo">
      <div><h2>${escapar(c.nome)}</h2><p>${selo(c.status)} · cadastrado em ${dataBR(c.criado_em)} · ${escapar(c.origem || "")}</p></div>
    </header>
    <dl class="crm-info">
      ${info("WhatsApp", `<a href="${linkWhatsApp(c.telefone)}" target="_blank" rel="noopener">${escapar(formatarTelefone(c.telefone))}</a>`)}
      ${info("E-mail", escapar(c.email))}
      ${info("CRECI", escapar(c.creci))}
      ${info("Imobiliária", imobDoCorretor(c).map((i) => `<button class="crm-link-texto" data-acao="abrir-imob" data-id="${escapar(i.id)}">${escapar(i.nome)}</button>`).join(", ") || escapar(c.imobiliaria))}
      ${info("Site / perfil", escapar(c.site))}
      ${info("Atende", escapar(`${c.categoria} · ${c.operacao}`))}
      ${info("Bairros principais", escapar([c.bairro1, c.bairro2].filter(Boolean).join(" / ")))}
      ${info("Outros bairros", escapar(extras.marcados.join(", ")))}
      ${info("Citados nas observações", escapar(extras.citados.join(", ")))}
      ${info("Especialidades", escapar((c.especialidades || []).join(", ")))}
      ${info("Zonas", escapar(zonas))}
      ${info("Faixas de locação", escapar((c.faixas_locacao || []).join(", ")))}
      ${info("Faixas de venda", escapar((c.faixas_venda || []).join(", ")))}
      ${info("Observações", escapar(c.observacoes))}
    </dl>
    <div class="crm-acoes">
      <button class="botao botao--detalhes" data-acao="editar-corretor">Editar dados</button>
      <button class="botao crm-perigo" data-acao="excluir-corretor">Excluir corretor</button>
    </div>
    <h3>Leads enviados a este corretor (${envios.length})</h3>
    ${envios.length ? `<ul class="crm-envios">${envios.map((e) => itemEnvio(e, { lead: true })).join("")}</ul>`
      : '<p class="crm-sem-dados">Nenhum lead enviado ainda.</p>'}
    <h3>Clientes que combinam com o perfil dele (${clientesCompativeis(c).length})</h3>
    ${htmlClientesCompativeis(c)}
  </div>`);
}

function janelaForm(tipo, registro) {
  const ehLead = tipo === "lead";
  const campos = ehLead ? CAMPOS_LEAD_PAINEL : CAMPOS_CORRETOR_PAINEL;
  const base = registro || (ehLead ? { origem: "Cadastro manual", etapa: "Novo" } : { status: "Ativo" });
  const valores = ehLead ? { ...base, captado_digo: base.captado_digo ? "Sim" : "Não" } : base;
  abrirJanela(`<div class="crm-janela__corpo">
    <h2>${registro ? "Editar" : "Novo"} ${ehLead ? "lead" : "corretor"}</h2>
    <form class="crm-form" data-form="${tipo}" data-id="${registro ? registro.id : ""}" novalidate>
      <div class="crm-grade-campos">${montarCampos(campos, valores)}</div>
      <p class="crm-erro oculto" role="alert"></p>
      <div class="crm-acoes">
        <button type="submit" class="botao botao--zap">Salvar</button>
        <button type="button" class="botao botao--detalhes" data-acao="cancelar-form">Cancelar</button>
      </div>
    </form></div>`);
  ativarForm($("janela-conteudo").querySelector("form"), campos);
}

/* ---------- Excluir ---------- */
async function excluirLead(id) {
  const l = leadPorId(id);
  if (!l) return;
  const n = enviosDoLead(id).length;
  if (!confirm(`Excluir o lead "${l.nome}"?\n\nIsso apaga também ${n} envio(s), o histórico e os lembretes dele. Não dá para desfazer.`)) return;
  if (await gravar(sb.from("leads").delete().eq("id", id))) { fecharJanela(); aviso("Lead excluído."); await carregar(); }
}
async function excluirCorretor(id) {
  const c = corretorPorId(id);
  if (!c) return;
  const n = enviosDoCorretor(id).length;
  if (!confirm(`Excluir o corretor "${c.nome}"?\n\nIsso apaga também ${n} envio(s) feito(s) a ele. Não dá para desfazer.\nPara só parar de enviar leads, use "Pausar".`)) return;
  if (await gravar(sb.from("corretores").delete().eq("id", id))) { fecharJanela(); aviso("Corretor excluído."); await carregar(); }
}

/* ---------- Menu ⋮ de cada linha ---------- */
const botaoMais = (tipo, id, nome) =>
  `<button type="button" class="crm-mais" data-acao="menu-linha" data-tipo="${tipo}" data-id="${id}" aria-haspopup="menu" aria-label="Mais opções para ${escapar(nome)}">⋮</button>`;

function fecharMenuLinha() { $("menu-linha").hidden = true; }
function abrirMenuLinha(botao) {
  const m = $("menu-linha");
  const { tipo, id } = botao.dataset;
  if (!m.hidden && m.dataset.id === id) { fecharMenuLinha(); return; }
  const dados = `data-tipo="${tipo}" data-id="${id}" role="menuitem"`;
  const c = tipo === "corretor" ? corretorPorId(id) : null;
  m.dataset.id = id;
  m.innerHTML = `
    <button ${dados} data-acao="menu-abrir">Abrir</button>
    <button ${dados} data-acao="menu-editar">Editar</button>
    ${c ? `<button ${dados} data-acao="menu-status">${c.status === "Ativo" ? "Pausar (não recebe leads)" : "Reativar"}</button>` : ""}
    <button ${dados} data-acao="menu-excluir" class="crm-menu-linha__perigo">Excluir ${tipo === "lead" ? "lead" : "corretor"}</button>`;
  m.hidden = false;
  // Posiciona junto ao botão, sem sair da tela.
  const r = botao.getBoundingClientRect();
  const esquerda = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8));
  const cabeEmbaixo = r.bottom + m.offsetHeight + 8 < innerHeight;
  m.style.left = esquerda + "px";
  m.style.top = (cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - m.offsetHeight - 4)) + "px";
  m.querySelector("button").focus();
}

/* ---------- Menu lateral: recolher / abrir ---------- */
function recolherMenu(recolhido) {
  $("v-app").classList.toggle("recolhido", recolhido);
  const b = document.querySelector(".crm-recolher");
  b.setAttribute("aria-expanded", String(!recolhido));
  b.querySelector(".crm-aba__nome").textContent = recolhido ? "Abrir menu" : "Recolher menu";
  try { localStorage.setItem("crm-menu-recolhido", recolhido ? "1" : ""); } catch { /* sem armazenamento: só não lembra */ }
}
try { if (localStorage.getItem("crm-menu-recolhido")) recolherMenu(true); } catch { /* ignora */ }

/* ---------- Ações ---------- */
const ACOES = {
  ...ACOES_DIGO,
  "sair": async () => { await sb.auth.signOut(); usuario = null; fecharJanela(); mostrarTela("v-login"); },
  "copiar-link": async () => {
    const link = new URL("cadastro.html", location.href).href;
    try { await navigator.clipboard.writeText(link); aviso("Link copiado: " + link); }
    catch { prompt("Copie o link de cadastro:", link); }
  },
  "fechar": () => fecharJanela(),
  "abrir-lead": (b) => janelaLead(b.dataset.id),
  "abrir-corretor": (b) => janelaCorretor(b.dataset.id),
  "novo-lead": () => { aberto = null; janelaForm("lead"); },
  "novo-corretor": () => { aberto = null; janelaForm("corretor"); },
  "editar-lead": () => janelaForm("lead", leadPorId(aberto.id)),
  "editar-corretor": () => janelaForm("corretor", corretorPorId(aberto.id)),
  "cancelar-form": () => { if (aberto) reabrirJanela(); else fecharJanela(); },
  "ver-mais": () => { verMais = !verMais; reabrirJanela(); },
  "excluir-lead": () => excluirLead(aberto.id),
  "excluir-corretor": () => excluirCorretor(aberto.id),
  // Menu ⋮ das listas
  "menu-linha": (b) => abrirMenuLinha(b),
  "menu-abrir": (b) => (b.dataset.tipo === "lead" ? janelaLead(b.dataset.id) : janelaCorretor(b.dataset.id)),
  "menu-editar": (b) => {
    aberto = { tipo: b.dataset.tipo, id: b.dataset.id };
    janelaForm(b.dataset.tipo, b.dataset.tipo === "lead" ? leadPorId(b.dataset.id) : corretorPorId(b.dataset.id));
  },
  "menu-excluir": (b) => (b.dataset.tipo === "lead" ? excluirLead(b.dataset.id) : excluirCorretor(b.dataset.id)),
  "menu-status": async (b) => {
    const c = corretorPorId(b.dataset.id);
    const novo = c.status === "Ativo" ? "Pausado" : "Ativo";
    if (await gravar(sb.from("corretores").update({ status: novo }).eq("id", c.id))) {
      aviso(novo === "Ativo" ? `${c.nome} voltou a receber leads.` : `${c.nome} pausado: não aparece mais nas sugestões.`);
      await carregar();
    }
  },
  "envios-todos-status": () => { filtros.statusEnvio = ""; $("filtro-envio").value = ""; listaEnvios(); },
  "recolher": () => recolherMenu(!$("v-app").classList.contains("recolhido")),
  "copiar-msg": async () => {
    try { await navigator.clipboard.writeText($("msg-texto").value); aviso("Texto copiado."); }
    catch { $("msg-texto").select(); aviso("Selecione e copie o texto manualmente.", true); }
  },
  // Sem preventDefault: o navegador abre o WhatsApp; aqui só registramos o envio.
  "enviar": async (link) => {
    const l = leadPorId(aberto.id);
    const c = corretorPorId(link.dataset.corretor);
    link.href = linkWhatsApp(c.telefone, textoEnvio(c, $("msg-texto").value));
    await registrarEnvio(l, c);
  },
  // Enviar a partir da ficha do corretor (mensagem padrão do cliente)
  "enviar-cliente": async (link) => {
    const l = leadPorId(link.dataset.lead);
    const c = corretorPorId(link.dataset.corretor);
    if (!l || !c) return;
    link.href = linkWhatsApp(c.telefone, textoEnvio(c, mensagemLead(l)));
    await registrarEnvio(l, c);
  },
  "ver-todos-clientes": () => { verTodosClientes = !verTodosClientes; reabrirJanela(); },
};
async function registrarEnvio(l, c) {
    const existente = enviosDoLead(l.id).find((e) => e.corretor_id === c.id);
    const ok = existente
      ? await gravar(sb.from("envios").update({ status: "Aguardando", proxima_cobranca: daquiADias(DIAS_COBRANCA) }).eq("id", existente.id))
      : await gravar(sb.from("envios").insert({ lead_id: l.id, corretor_id: c.id, proxima_cobranca: daquiADias(DIAS_COBRANCA) }));
    if (!ok) return;
    if (["Novo", "Qualificado"].includes(l.etapa)) await gravar(sb.from("leads").update({ etapa: "Buscando imóveis" }).eq("id", l.id));
    await anotar(l.id, `${existente ? "Reenviado" : "Enviado"} para ${c.nome} pelo WhatsApp.`);
    await carregar();
}
Object.assign(ACOES, {
  "cobrar": async (link) => {
    const e = envioPorId(link.dataset.id);
    const c = corretorPorId(e.corretor_id);
    if (!(await gravar(sb.from("envios").update({ cobrado_em: hojeISO(), proxima_cobranca: daquiADias(DIAS_COBRANCA) }).eq("id", e.id)))) return;
    await anotar(e.lead_id, `Cobrança enviada a ${c.nome} pelo WhatsApp.`);
    await carregar();
  },
  "excluir-envio": async (b) => {
    if (!confirm("Excluir este registro de envio?")) return;
    if (await gravar(sb.from("envios").delete().eq("id", b.dataset.id))) await carregar();
  },
  "excluir-tarefa": async (b) => {
    if (await gravar(sb.from("tarefas").delete().eq("id", b.dataset.id))) await carregar();
  },
});
Object.assign(ACOES, IMOB_ACOES, ANUNCIO_ACOES, TAREFA_ACOES);

document.addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-acao]");
  if (!alvo || !["menu-linha", "im-menu", "an-menu"].includes(alvo.dataset.acao)) fecharMenuLinha();
  if (!alvo || alvo.matches("select, input")) return;
  const acao = ACOES[alvo.dataset.acao];
  if (acao) acao(alvo, e);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("tr[data-acao]")) e.target.click();
  if (e.key === "Escape") fecharMenuLinha();
});
addEventListener("scroll", fecharMenuLinha, true);
addEventListener("resize", fecharMenuLinha);

document.addEventListener("change", async (e) => {
  const t = e.target;
  const acao = t.dataset.acao;
  if (acao === "mudar-etapa") {
    if (await gravar(sb.from("leads").update({ etapa: t.value }).eq("id", aberto.id))) {
      await anotar(aberto.id, `Etapa alterada para "${t.value}".`);
      await carregar();
    }
  } else if (acao === "envio-status") {
    const env = envioPorId(t.dataset.id);
    if (await gravar(sb.from("envios").update({ status: t.value }).eq("id", env.id))) {
      await anotar(env.lead_id, `${corretorPorId(env.corretor_id)?.nome}: status do envio alterado para "${t.value}".`);
      await carregar();
    }
  } else if (acao === "envio-retorno") {
    // Não redesenha a tela, para não atrapalhar quem está digitando em vários campos.
    const env = envioPorId(t.dataset.id);
    const retorno = t.value.trim() || null;
    if (await gravar(sb.from("envios").update({ retorno }).eq("id", env.id))) { env.retorno = retorno; aviso("Retorno salvo."); }
  } else if (acao === "envio-cobranca") {
    if (await gravar(sb.from("envios").update({ proxima_cobranca: t.value || null }).eq("id", t.dataset.id))) await carregar();
  } else if (acao === "concluir-tarefa") {
    if (await gravar(sb.from("tarefas").update({ concluida: t.checked }).eq("id", t.dataset.id))) await carregar();
  } else if (t.id === "filtro-etapa") {
    filtros.etapa = t.value; listaLeads();
  } else if (t.id === "filtro-envio") {
    filtros.statusEnvio = t.value; listaEnvios();
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "busca-lead") { filtros.buscaLead = e.target.value; listaLeads(); }
  if (e.target.id === "busca-corretor") { filtros.buscaCorretor = e.target.value; listaCorretores(); }
  if (e.target.id === "busca-envio") { filtros.buscaEnvio = e.target.value; listaEnvios(); }
  if (e.target.id === "msg-texto" && aberto?.tipo === "lead") {
    // Guarda o texto ajustado e atualiza os links de envio com ele.
    msgEditada = { leadId: aberto.id, texto: e.target.value };
    document.querySelectorAll('#janela [data-acao="enviar"]').forEach((a) => {
      a.href = linkWhatsApp(corretorPorId(a.dataset.corretor).telefone, textoEnvio(corretorPorId(a.dataset.corretor), e.target.value));
    });
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target;
  const tipo = f.dataset.form;
  if (!tipo) return;
  e.preventDefault();

  if (tipo.startsWith("digo-")) return enviarDigo(f, tipo);
  if (tipo === "tarefa") {
    const dados = { lead_id: aberto.id, descricao: f.elements.descricao.value.trim(), vence_em: f.elements.vence_em.value };
    if (dados.descricao && dados.vence_em && await gravar(sb.from("tarefas").insert(dados))) await carregar();
    return;
  }
  if (tipo === "nota") {
    const texto = f.elements.texto.value.trim();
    if (texto && await anotar(aberto.id, texto)) await carregar();
    return;
  }

  // Formulário de lead ou corretor (novo ou edição)
  const campos = tipo === "lead" ? CAMPOS_LEAD_PAINEL : CAMPOS_CORRETOR_PAINEL;
  const caixaErro = f.querySelector(".crm-erro");
  caixaErro.classList.add("oculto");
  if (!f.checkValidity()) { f.reportValidity(); return; }
  const { dados, erro } = lerCampos(f, campos);
  if (erro) { caixaErro.textContent = erro; caixaErro.classList.remove("oculto"); return; }
  const id = f.dataset.id;
  if (!dados.origem) { if (tipo === "lead" || !id) dados.origem = "Cadastro manual"; else delete dados.origem; }

  if (tipo === "lead" && !digoAtivo) { delete dados.captado_digo; }
  else if (tipo === "lead") {
    // "Captado pelo Digo": grava sim/não e a data em que foi marcado (conta no Pagamentos Digo)
    const antes = id ? leadPorId(id)?.captado_digo : false;
    dados.captado_digo = dados.captado_digo === "Sim";
    if (dados.captado_digo && !antes) dados.captado_digo_em = new Date().toISOString();
    if (!dados.captado_digo) dados.captado_digo_em = null;
  }
  const tabela = tipo === "lead" ? "leads" : "corretores";
  const ok = await gravar(id ? sb.from(tabela).update(dados).eq("id", id) : sb.from(tabela).insert(dados));
  if (!ok) return;
  aviso("Salvo.");
  if (id && tipo === "lead") msgEditada = null; // a mensagem pronta volta a refletir os dados novos
  if (!id) fecharJanela();
  await carregar();
  if (id) reabrirJanela();
});

document.querySelectorAll(".crm-aba[data-aba]").forEach((b) => b.addEventListener("click", () => { aba = b.dataset.aba; desenhar(); window.scrollTo({ top: 0 }); }));
$("janela").addEventListener("close", () => { aberto = null; });
$("janela").addEventListener("click", (e) => { if (e.target === $("janela")) fecharJanela(); });

iniciar();
