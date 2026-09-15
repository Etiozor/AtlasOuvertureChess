// Port React de « Atlas - carte d'ouvertures.dc.html » (prototype Claude Design).
// La logique DCLogic (state/setState/props) map 1:1 sur React.Component.
// « Mes parties » lit /api/tree (vraies parties) ; l'échiquier se dessine depuis
// to_fen. Cahier / chapitres / import restent en mock local (pas de backend).
import { Component } from "react";
import {
  START, GLYPH, idx, sqName, isWhite, pseudoSan, legalTargets, diffSquares, applyMoveInPlace,
  fenToBoard, isFen, splitPgnMoves, parseLineToFree,
} from "./chess";
import {
  type Node, type Line, EMPTY_ROOT, TREE_C, buildTrie, findNode, wilsonLower, winColor,
  NAMES, IN_CAHIER, CHAPTERS, SOURCES, adaptApiTree, parseBookTsv, parseMoveLines,
} from "./tree";
import { fetchTree, fetchMeta, ingestGames, type Color, type Source, type Meta } from "./api";
import { css, Button } from "./ui";

const fmt = (n: number) => n.toLocaleString("fr-FR");

interface Free { uci: string; san: string }
interface State {
  view: "parties" | "cahier";
  cahierTab: "arbre" | "chapitres";
  color: Color;
  minGames: number | null;
  depth?: number;
  speeds: string[];
  hover: string | null;
  killed: string[];
  cahier: string[];
  collapsed?: string[];
  zoom?: number;
  rail?: boolean;
  modal: "board" | "new" | "import" | "sync" | null;
  boardSrc?: "parties" | "cahier";
  syncSource?: Source;
  syncUser?: string;
  syncBusy?: boolean;
  syncMsg?: string | null;
  syncErr?: string | null;
  path: string[];
  free?: Free[];
  sel?: number | null;
  flipped?: boolean;
  newName: string;
  srcPick?: number;
  flash: string | null;
  startFen?: string | null;   // position importée (FEN) servant de base à l'échiquier
  importText?: string;
  importErr?: string | null;
  importFlash?: string | null;
  nameOverrides?: Record<string, string>;  // noms importés (livre Lichess)
  cahierLines?: Line[];                     // cahier importé (Chessable) -> arbre dynamique
  partiesTree: Node | null;
  metaData: Meta | null;
  apiError: string | null;
}

export class App extends Component<{}, State> {
  state: State = {
    view: "parties", cahierTab: "arbre", color: "white",
    minGames: null, speeds: ["Blitz", "Rapide"],
    hover: null, killed: ["e4 e5 Nf3 d6"], cahier: IN_CAHIER.slice(),
    modal: null, path: [], newName: "", flash: null,
    partiesTree: null, metaData: null, apiError: null,
  };

  _scroll: HTMLElement | null = null;
  _wheelH?: (e: WheelEvent) => void;
  _centerT?: ReturnType<typeof setTimeout>;
  _userPanned = false;
  _sig?: string;
  _gw?: number;
  _t1?: ReturnType<typeof setTimeout>;
  _dragMoved = false;
  _cTree?: Node;
  _cSig?: number;

  componentDidMount() {
    fetchMeta().then((m) => this.setState({ metaData: m })).catch((e) => this.setState({ apiError: String(e) }));
    this.loadParties("white");
  }

  loadParties(color: Color) {
    fetchTree(color)
      .then((r) => this.setState({ partiesTree: adaptApiTree(r.tree), apiError: null }))
      .catch((e) => this.setState({ apiError: String(e) }));
  }

  get seuil(): number { return this.state.minGames ?? 6; }

  // Cahier : arbre importé (Chessable) s'il existe, sinon la démo TREE_C.
  cahierTree(): Node {
    const lines = this.state.cahierLines;
    if (!lines || !lines.length) return TREE_C;
    if (this._cSig !== lines.length) { this._cSig = lines.length; this._cTree = buildTrie(lines); }
    return this._cTree!;
  }

  // Nom d'ouverture : override importé (livre Lichess) puis table intégrée.
  nm(key: string): string | undefined {
    return this.state.nameOverrides?.[key] ?? NAMES[key];
  }

  activeTree(): Node {
    if (this.state.view === "cahier") return this.cahierTree();
    return this.state.partiesTree ?? EMPTY_ROOT;
  }

  isCahierView() { return this.state.view === "cahier"; }
  onCahierLine(key: string) {
    return this.state.cahier.some((k) => k === key || k.indexOf(key + " ") === 0);
  }

  // Layout tidy top->bottom sur l'arbre élagué.
  graph() {
    const isCahier = this.state.view === "cahier";
    const min = isCahier ? 1 : this.seuil;
    const killed = this.state.killed;
    const maxPly = this.state.depth ?? 8;
    const collapsed = this.state.collapsed || [];
    const inCahierLine = (key: string) => !isCahier && this.onCahierLine(key);
    const countDesc = (nd: Node): number => nd.children.reduce((s, c) => s + 1 + countDesc(c), 0);
    const keep = (nd: Node) => nd.n >= min && nd.ply < maxPly && !killed.some((k) => nd.key === k || nd.key.indexOf(k + " ") === 0);
    const prune = (nd: Node): Node => ({ ...nd, children: collapsed.indexOf(nd.key) >= 0 ? [] : nd.children.filter(keep).map(prune) });
    const root = prune(this.activeTree());

    const rowH = 96, padX = 90, padY = 64;
    let leaf = 0;
    const place = (nd: Node, depth: number): Node => {
      nd.depth = depth;
      if (!nd.children.length) { nd.ux = leaf++; }
      else {
        nd.children.forEach((c) => place(c, depth + 1));
        const us = nd.children.map((c) => c.ux!);
        nd.ux = (Math.min.apply(null, us) + Math.max.apply(null, us)) / 2;
      }
      return nd;
    };
    place(root, 0);
    const maxDepth = (nd: Node): number => nd.children.length ? 1 + Math.max(...nd.children.map(maxDepth)) : 0;
    const depth = maxDepth(root);
    const cols = Math.max(1, leaf - 1);
    const width = Math.max(980, cols * 84 + padX * 2);
    const height = depth * rowH + padY * 2 + 52;
    const X = (u: number) => padX + (cols ? u / cols * (width - padX * 2) : (width - padX * 2) / 2);
    const Y = (d: number) => padY + (depth - d) * rowH; // racine en bas, exploration vers le haut

    const nodes: any[] = [], links: any[] = [];
    const walk = (nd: Node) => {
      for (const c of nd.children) {
        const w = Math.max(1.2, Math.min(20, 20 * Math.sqrt(c.n / (root.n || 1))));
        const x1 = X(nd.ux!), y1 = Y(nd.depth!), x2 = X(c.ux!), y2 = Y(c.depth!);
        const my = y1 + (y2 - y1) * 0.55;
        links.push({
          d: "M" + x1 + " " + y1 + " C" + x1 + " " + my + " " + x2 + " " + (y2 - (y2 - y1) * 0.45) + " " + x2 + " " + y2,
          stroke: inCahierLine(c.key) ? "#f4a259" : "#1a1a1a",
          w: inCahierLine(c.key) ? Math.max(3, w) : w,
          op: inCahierLine(c.key) ? 0.95 : 0.3,
          dash: null,
        });
        walk(c);
      }
      if (nd.depth === 0 && !nd.san) {
        nodes.push({
          key: "__root", san: this.state.color === "white" ? "Blancs" : "Noirs",
          name: isCahier ? "Ce que je veux jouer" : fmt(this.activeTree().n) + " parties",
          x: X(nd.ux!), y: Y(0), r: 30, rHit: 38, fill: "#1a1a1a", op: 1, stroke: "#1a1a1a", sw: 1,
          nd, inCahier: false,
        });
      }
      for (const c of nd.children) {
        const r = 26; // rayon constant : ni le volume ni la longueur du coup ne le font varier.
        const x = X(c.ux!), y = Y(c.depth!);
        const byWhite = c.ply % 2 === 0;
        // countDesc tourne sur l'arbre source : prune() a déjà vidé les enfants du nœud replié.
        const hidden = collapsed.indexOf(c.key) >= 0 ? Math.max(1, countDesc(findNode(this.activeTree(), c.key))) : 0;
        const onCahier = inCahierLine(c.key);
        nodes.push({
          key: c.key, san: c.san, name: this.nm(c.key) || c.opening_name || null, byWhite, hidden,
          x, y, r, rHit: r + 8,
          fill: isCahier ? (byWhite ? "#4a453c" : "#f0e6c8") : winColor(c.score),
          op: 1,
          stroke: onCahier ? "#f4a259" : "rgba(26,26,26,.45)",
          sw: onCahier ? 4 : hidden ? 3.5 : 1.8,
          nd: c, inCahier: onCahier,
        });
      }
    };
    walk(root);
    const seen: Record<string, boolean> = {};
    const uniq = nodes.filter((n) => seen[n.key] ? false : (seen[n.key] = true));
    return { nodes: uniq, links, width, height, root };
  }

  attachScroll = (el: HTMLElement | null) => {
    if (this._scroll && this._wheelH) this._scroll.removeEventListener("wheel", this._wheelH);
    this._scroll = el;
    if (el) {
      this._wheelH = (e) => this.handleWheel(e);
      el.addEventListener("wheel", this._wheelH, { passive: false });
      this.scheduleCenter(true);
    }
  };

  scheduleCenter(force: boolean) {
    if (force) this._userPanned = false;
    clearTimeout(this._centerT);
    this._centerT = setTimeout(() => {
      const el = this._scroll;
      if (!el || (this._userPanned && !force)) return;
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    }, 0);
  }

  // Zoom molette (ctrl/⌘) via écouteur natif non-passif : React rend onWheel passif.
  handleWheel(e: WheelEvent) {
    const el = this._scroll;
    if (!e.ctrlKey && !e.metaKey) {
      if (el && e.shiftKey) { el.scrollLeft += e.deltaY; this._userPanned = true; }
      else if (el && el.scrollHeight <= el.clientHeight && e.deltaY) { el.scrollLeft += e.deltaY; this._userPanned = true; }
      return;
    }
    e.preventDefault();
    const zoom = this.state.zoom ?? 0.75;
    const z = Math.max(0.3, Math.min(1.6, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    this.setState({ zoom: Math.round(z * 100) / 100 }, () => this.scheduleCenter(false));
  }

  toggleCollapse(key: string) {
    if (key === "__root") return;
    const c = this.state.collapsed || [];
    this.setState({ collapsed: c.indexOf(key) >= 0 ? c.filter((k) => k !== key) : c.concat([key]), hover: key });
  }

  boardTree(): Node {
    if ((this.state.boardSrc || "parties") === "cahier") return this.cahierTree();
    return this.state.partiesTree ?? EMPTY_ROOT;
  }

  openBoard(key: string) {
    this.setState({
      modal: "board", boardSrc: this.state.view === "cahier" ? "cahier" : "parties",
      path: key === "__root" ? [] : key.split(" "), free: [], sel: null, flash: null, hover: null,
      startFen: null,
    });
  }

  boardVals() {
    const isNew = this.state.modal === "new";
    const path = this.state.path;
    const rootNode = isNew ? null : this.boardTree();
    let nd: Node | null = rootNode;
    const inTree: Node[] = [];
    const off: string[] = [];
    for (const san of path) {
      const c = nd && nd.children.find((x) => x.san === san);
      if (c) { inTree.push(c); nd = c; } else { off.push(san); }
    }
    const cur = inTree.length ? inTree[inTree.length - 1] : null;
    const free = this.state.free || [];
    // Position importée (FEN) : base isolée, sans contexte d'arbre.
    const fenMode = !isNew && !!this.state.startFen;
    const fenWhite = fenMode ? this.state.startFen!.split(/\s+/)[1] !== "b" : true;
    // Position de base : FEN importé, sinon le nœud (to_fen / ucis précalculés),
    // puis les coups libres (hors arbre) appliqués par-dessus.
    const bArr = (fenMode ? fenToBoard(this.state.startFen!) : (cur ? cur.board : START)).slice();
    for (const m of free) applyMoveInPlace(bArr, m.uci);
    let last: [number, number] | null = null;
    if (free.length) { const u = free[free.length - 1].uci; last = [idx(u.slice(0, 2)), idx(u.slice(2, 4))]; }
    else if (cur) {
      const prev = inTree.length >= 2 ? inTree[inTree.length - 2].board : (rootNode ? rootNode.board : null);
      if (prev) last = diffSquares(prev, cur.board);
    }
    const pos = { b: bArr, last };
    const ply = (fenMode ? (fenWhite ? 0 : 1) : (cur ? cur.ply + 1 : 0)) + free.length;
    const whiteToMove = ply % 2 === 0;
    const sel = this.state.sel;

    const playSquares = (from: number, to: number) => {
      const uci = sqName(from) + sqName(to);
      // Match structurel d'un enfant : la case de départ se vide et la pièce arrive.
      const nextInTree = !fenMode && free.length === 0
        ? (cur ? cur.children : (isNew ? [] : this.boardTree().children)).find((c) => c.board[from] === "." && c.board[to] === pos.b[from])
        : null;
      if (nextInTree) this.setState({ path: path.concat([nextInTree.san!]), sel: null, flash: null });
      else this.setState({ free: free.concat([{ uci, san: pseudoSan(pos.b, from, to) }]), sel: null, flash: null });
    };
    const onSquare = (i: number) => {
      const p = pos.b[i];
      if (sel == null) { if (p !== "." && isWhite(p) === whiteToMove) this.setState({ sel: i }); return; }
      if (i === sel) { this.setState({ sel: null }); return; }
      if (p !== "." && isWhite(p) === isWhite(pos.b[sel])) { this.setState({ sel: i }); return; }
      if (legalTargets(pos.b, sel).indexOf(i) < 0) { this.setState({ sel: null }); return; }
      playSquares(sel, i);
    };
    const parentN = inTree.length > 1 ? inTree[inTree.length - 2].n : (this.boardTree().n || 1);

    const flipped = !!this.state.flipped;
    const targets = sel == null ? [] : legalTargets(pos.b, sel);
    const squares: any[] = [];
    const order: number[] = [];
    for (let k = 0; k < 64; k++) order.push(flipped ? 63 - k : k);
    for (const i of order) {
      const file = i % 8, rank = Math.floor(i / 8);
      const dark = (file + rank) % 2 === 1;
      const isLast = pos.last && (i === pos.last[0] || i === pos.last[1]);
      const p = pos.b[i];
      const white = p !== "." && p === p.toUpperCase();
      const isTarget = targets.indexOf(i) >= 0;
      const showFile = flipped ? rank === 0 : rank === 7;
      const showRank = flipped ? file === 7 : file === 0;
      const selected = sel === i;
      const grabbable = p !== "." && white === whiteToMove;
      squares.push({
        style: "position:relative;display:flex;align-items:center;justify-content:center;user-select:none;" +
          "cursor:" + (grabbable ? "grab" : isTarget ? "pointer" : "default") + ";" +
          "background:" + (selected ? "#b9b04e" : isLast ? "#cdc86a" : dark ? "#8779d0" : "#eeeef2") + ";" +
          (selected ? "box-shadow:inset 0 0 0 3px rgba(26,26,26,.55);" : ""),
        pieceStyle: "position:relative;z-index:2;font-size:46px;line-height:1;pointer-events:none;" +
          "filter:drop-shadow(0 1px 1px rgba(28,26,23,.45));" +
          (p === "." ? "" : white
            ? "color:#f1ecd6;-webkit-text-stroke:2.4px #17150f;paint-order:stroke fill;"
            : "color:#17150f;-webkit-text-stroke:2.4px #ece8d8;paint-order:stroke fill;"),
        glyph: p === "." ? "" : GLYPH[p],
        hasCoord: showFile || showRank,
        coord: showRank ? String(8 - rank) : String.fromCharCode(97 + file),
        coordStyle: "position:absolute;z-index:3;" + (showRank ? "top:3px;left:4px" : "bottom:2px;right:4px") +
          ";font:700 11px/1 var(--font-interface);letter-spacing:.02em;color:" + (dark ? "#eeeef2" : "#8779d0"),
        isTarget,
        targetStyle: p === "."
          ? "position:absolute;z-index:1;width:20px;height:20px;border-radius:50%;background:rgba(28,26,23,.28)"
          : "position:absolute;z-index:1;inset:3px;border-radius:50%;border:5px solid rgba(28,26,23,.28)",
        draggable: grabbable,
        click: () => onSquare(i),
        dragStart: () => this.setState({ sel: i }),
        dragOver: (e: React.DragEvent) => e.preventDefault(),
        drop: (e: React.DragEvent) => { e.preventDefault(); if (sel != null && sel !== i) playSquares(sel, i); },
      });
    }

    const allSans = path.concat(free.map((m) => m.san));
    const moves = allSans.map((san, i) => {
      const isFree = i >= path.length;
      const last2 = i === allSans.length - 1;
      return {
        san, current: last2, free: isFree,
        go: () => isFree
          ? this.setState({ free: free.slice(0, i - path.length + 1), sel: null, flash: null })
          : this.setState({ path: path.slice(0, i + 1), free: [], sel: null, flash: null }),
      };
    });

    const cellStyle = (m: any, filled: boolean) => "flex:1;min-width:0;height:26px;padding:0 8px;text-align:left;border:none;border-radius:var(--radius-sm);background:" +
      (!filled ? "transparent;color:var(--color-ink-muted);cursor:default" :
        m.current ? "var(--tint-primary-bg);color:var(--color-primary-ink);cursor:pointer" :
          m.free ? "var(--tint-warning-bg);color:var(--color-warning-ink);cursor:pointer" : "transparent;color:var(--color-ink);cursor:pointer") +
      ";font:600 13px var(--font-mono)";
    const rows: any[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      const w = moves[i], b = moves[i + 1];
      rows.push({
        no: (i / 2 + 1) + ".",
        style: "display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:var(--border-hairline-soft)",
        w: w ? w.san : "", b: b ? b.san : "…",
        wStyle: cellStyle(w || {}, !!w), bStyle: cellStyle(b || {}, !!b),
        wGo: w ? w.go : () => {}, bGo: b ? b.go : () => {},
      });
    }

    const kids = fenMode || free.length ? [] : (cur ? cur.children : (isNew ? [] : this.boardTree().children));
    const kidMax = kids.length ? kids[0].n : 1;
    const candidates = kids.map((c) => ({
      san: c.san,
      barStyle: "display:block;height:100%;width:" + Math.round(100 * c.n / kidMax) + "%;background:" + winColor(c.score),
      meta: c.n + " parties · " + Math.round(c.score * 100) + " %",
      play: () => this.setState({ path: path.concat([c.san!]), sel: null, flash: null }),
    }));

    let name: string | null = null;
    if (cur) {
      const parts = cur.key.split(" ");
      for (let i = parts.length; i > 0 && !name; i--) {
        const k = parts.slice(0, i).join(" ");
        const nk = this.nm(k);
        if (nk) name = nk + (i === parts.length ? "" : " · suite");
      }
      if (!name && cur.opening_name) name = cur.opening_name;
    }
    const sc = cur ? cur.score : 0;
    return {
      squares,
      isNew, hasStats: !!cur && !isNew && !free.length, emptyLine: !allSans.length,
      eyebrow: isNew ? "Saisie manuelle" : fenMode ? "Import · position FEN" : off.length ? "Exploration" : (this.state.boardSrc === "cahier" ? "Cahier · répertoire voulu" : "Mes parties · ") + (this.state.color === "white" ? "blancs" : "noirs"),
      title: isNew ? (this.state.newName || "Nouvelle ouverture") : fenMode ? "Position importée" : (name || (path.length ? "Ligne sans nom" : "Position de départ")),
      n: cur ? cur.n : 0,
      wr: cur ? Math.round(sc * 100) + " %" : "—",
      wrStyle: "color:var(--color-primary-ink)",
      prob: cur ? Math.round(100 * cur.n / parentN) + " %" : "—",
      wilson: cur ? Math.round(wilsonLower(sc, Math.max(2, cur.n)) * 100) + " %" : "—",
      plyLabel: (allSans.length ? "coup " + (Math.floor((allSans.length - 1) / 2) + 1) + " · " : "") + (whiteToMove ? "aux blancs de jouer" : "aux noirs de jouer"),
      rows, candidates, noCandidates: candidates.length === 0,
      flip: () => this.setState({ flipped: !this.state.flipped }),
      nextLabel: "Coups suivants dans mes parties", showNext: !isNew,
      offBook: free.length > 0 || off.length > 0,
      newName: this.state.newName,
      addLabel: isNew ? "Enregistrer dans le cahier" : "Ajouter au cahier d'ouverture",
      setName: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ newName: e.target.value }),
      first: () => this.setState({ path: [], free: [], sel: null }),
      prev: () => free.length
        ? this.setState({ free: free.slice(0, -1), sel: null })
        : this.setState({ path: path.slice(0, -1), sel: null }),
      next: () => kids.length && this.setState({ path: path.concat([kids[0].san!]), sel: null }),
      addToCahier: () => {
        const key = allSans.join(" ");
        this.setState({
          cahier: this.state.cahier.indexOf(key) >= 0 ? this.state.cahier : this.state.cahier.concat([key]),
          flash: "ajout",
        });
      },
      kill: () => {
        const key = path.join(" ");
        this.setState({
          killed: this.state.killed.indexOf(key) >= 0 ? this.state.killed : this.state.killed.concat([key]),
          modal: null, hover: null,
        });
      },
      flash: !!this.state.flash,
      flashText: this.state.flash === "ajout" ? "Ligne ajoutée au cahier. Elle porte l'étoile sur la carte." : "",
    };
  }

  renderVals() {
    const g = this.graph();
    const sig = [this.state.view, this.state.cahierTab, this.state.color, this.seuil,
      this.state.depth, (this.state.collapsed || []).join("|"), this.state.killed.join("|")].join("~");
    if (sig !== this._sig) { this._sig = sig; this.scheduleCenter(true); }
    else if (g.width !== this._gw) { this._gw = g.width; this.scheduleCenter(false); }
    const useWilson = false; // metric "Score brut" par défaut (pas de contrôle exposé)
    const showNames = true;
    const zoom = this.state.zoom ?? 0.75;
    const isParties = this.state.view === "parties";
    const isCahier = !isParties;
    const seg = (on: boolean) => "flex:1;height:34px;border-radius:var(--radius-sm);cursor:pointer;font:600 11px/1 var(--font-interface);letter-spacing:.09em;text-transform:uppercase;border:1px solid " +
      (on ? "transparent;background:var(--color-primary);color:var(--color-ink-inverse)" : "rgba(0,0,0,.14);background:var(--color-bg);color:var(--color-ink)");
    const tab = (on: boolean) => "height:34px;padding:0 14px;border-radius:var(--radius-sm);cursor:pointer;font:600 12px/1 var(--font-interface);letter-spacing:.09em;text-transform:uppercase;border:1px solid " +
      (on ? "transparent;background:var(--color-bg);color:var(--color-ink)" : "rgba(253,248,232,.24);background:transparent;color:rgba(253,248,232,.75)");

    const nodes = g.nodes.map((n) => ({
      ...n,
      sanStyle: "position:absolute;left:" + n.x + "px;top:" + n.y + "px;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;" +
        "font:600 13px var(--font-mono);" +
        "color:" + (n.key === "__root" ? "#fdf8e8" : n.byWhite ? "#fdf8e8" : "#1a1a1a"),
      enter: () => this.setState({ hover: n.key }),
      click: (e: React.MouseEvent) => {
        if (this._dragMoved) return;
        if (e && (e.altKey || e.metaKey) && n.key !== "__root") {
          this.setState({ killed: this.state.killed.concat([n.key]), hover: null });
          return;
        }
        // Un clic plie ou déplie ; le double-clic ouvre l'analyse.
        clearTimeout(this._t1);
        this._t1 = setTimeout(() => this.toggleCollapse(n.key), 220);
      },
      dblClick: () => { clearTimeout(this._t1); if (!this._dragMoved) this.openBoard(n.key); },
      badgeStyle: n.hidden
        ? "position:absolute;left:" + (n.x + n.r * 0.78) + "px;top:" + (n.y - n.r * 0.62) + "px;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;" +
          "padding:3px 7px;border-radius:var(--radius-sm);background:#1a1a1a;color:var(--color-ink-inverse);font:600 10px/1 var(--font-interface);letter-spacing:.04em;box-shadow:var(--shadow-soft)"
        : "display:none",
      badge: n.hidden ? "+" + n.hidden : "",
      ringInner: n.r - 7,
      negative: n.byWhite === false && n.key !== "__root" && !this.isCahierView(),
    }));

    // Empilement des étiquettes qui se chevauchent : chacune descend d'un cran.
    const placed: any[] = [];
    const labels = nodes.filter((n) => n.name && showNames)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((n) => {
        const halfW = 8 + n.name.length * 4.2;
        let top = n.y + n.r + 7, guard = 0;
        while (guard++ < 6 && placed.some((p) => Math.abs(p.x - n.x) < p.halfW + halfW && Math.abs(p.top - top) < 22)) top += 22;
        placed.push({ x: n.x, top, halfW });
        return {
          name: n.name,
          style: "position:absolute;left:" + n.x + "px;top:" + top + "px;transform:translateX(-50%);pointer-events:none;white-space:nowrap;" +
            "padding:5px 10px;border-radius:var(--radius-sm);background:#1a1a1a;color:#fdf8e8;" +
            "font:600 12px/1 var(--font-display);letter-spacing:.08em;text-transform:uppercase",
        };
      });

    const hv = nodes.find((n) => n.key === this.state.hover);
    let tip: any = null;
    if (hv && hv.key !== "__root") {
      const nd = hv.nd;
      const parent = hv.key.indexOf(" ") > 0 ? findNode(this.activeTree(), hv.key.split(" ").slice(0, -1).join(" ")) : this.activeTree();
      const flipX = hv.x + 290 > g.width;
      const x = flipX ? hv.x - hv.r - 262 : hv.x + hv.r + 14;
      const y = Math.max(8, Math.min(g.height - 210, hv.y - 70));
      const line = hv.key.split(" ").map((s: string, i: number) => (i % 2 === 0 ? (i / 2 + 1) + "." : "") + s).join(" ");
      tip = {
        tone: isCahier ? "#4a453c" : winColor(nd.score),
        noStats: isCahier,
        style: "position:absolute;left:" + x + "px;top:" + y + "px;width:248px;padding:12px 14px 12px 20px;box-sizing:border-box;pointer-events:none;" +
          "background:var(--color-bg);border:var(--border-hairline);border-radius:var(--radius-sm);box-shadow:var(--shadow-soft);z-index:5",
        eyebrow: this.nm(hv.key) || ("coup " + (Math.floor(nd.ply / 2) + 1) + (nd.ply % 2 === 0 ? " · blancs" : " · noirs")),
        line: line.length > 34 ? "…" + line.slice(-33) : line,
        metricLabel: useWilson ? "wilson bas" : "win rate",
        winrate: Math.round((useWilson ? wilsonLower(nd.score, Math.max(2, nd.n)) : nd.score) * 100) + " %",
        wdl: nd.n + " parties jouées",
        prob: "prob. de jeu " + Math.round(100 * nd.n / (parent.n || 1)) + " % à ce nœud",
        conf: this.onCahierLine(hv.key) ? "sur une ligne du cahier" : "hors cahier",
        showStats: !isCahier,
        side: (nd.ply % 2 === 0 ? "Coup des blancs" : "Coup des noirs") + " · ligne préparée",
        hint: (this.state.collapsed || []).indexOf(hv.key) >= 0 ? "Clic : déplier" : "Clic : plier",
      };
    }

    const speeds = ["Bullet", "Blitz", "Rapide", "Classique"].map((label) => {
      const on = this.state.speeds.indexOf(label) >= 0;
      return {
        label,
        style: "height:30px;padding:0 10px;white-space:nowrap;border-radius:var(--radius-sm);cursor:pointer;font:600 11px/1 var(--font-interface);letter-spacing:.06em;border:1px solid " +
          (on ? "var(--tint-primary-bc);background:var(--tint-primary-bg);color:var(--color-primary-ink)" : "rgba(0,0,0,.14);background:var(--color-bg);color:var(--color-ink-muted)"),
        toggle: () => this.setState({ speeds: on ? this.state.speeds.filter((s) => s !== label) : this.state.speeds.concat([label]) }),
      };
    });

    const badgeStyle = (t: string) => "display:inline-block;white-space:nowrap;font:600 11px var(--font-interface);letter-spacing:.09em;text-transform:uppercase;padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--tint-" + t + "-bc);background:var(--tint-" + t + "-bg);color:var(--color-" + (t === "neutral" ? "ink" : t + "-ink") + ")";

    const boardV = this.boardVals();
    const counts = this.state.metaData?.counts_by_color;
    return {
      isParties, isCahier,
      railOpen: this.state.rail !== false, railClosed: this.state.rail === false,
      toggleRail: () => this.setState({ rail: this.state.rail === false }),
      showGraph: isParties || this.state.cahierTab === "arbre",
      showChapitres: isCahier && this.state.cahierTab === "chapitres",
      pageTitle: isParties ? "Carte de mes ouvertures" : this.state.cahierTab === "arbre" ? "Le répertoire voulu" : "Chapitres du cahier",
      pageSub: isParties
        ? "Racine en bas, exploration vers le haut. Clic : plier ou déplier une branche. Double-clic : ouvrir l'analyse. Alt-clic : tuer."
        : this.state.cahierTab === "arbre"
          ? "Écrit à la main : ce que je prépare, pas ce que je joue. Mêmes gestes que la carte des parties."
          : "Un chapitre par ouverture, avec la note et l'état de révision.",
      gw: g.width, gh: g.height,
      canvasStyle: "position:relative;width:" + g.width + "px;height:" + g.height + "px;transform:scale(" + zoom + ");transform-origin:0 0",
      canvasOuter: "position:relative;width:" + Math.round(g.width * zoom) + "px;height:" + Math.round(g.height * zoom) + "px;margin:-38px auto 0",
      scrollStyle: "flex:1;min-height:0;overflow:auto;background:var(--color-bg);position:relative;cursor:grab;touch-action:none;user-select:none",
      onPanStart: (e: React.PointerEvent) => {
        const el = this._scroll;
        if (!el || e.button === 2) return;
        e.preventDefault();
        const sx = e.clientX, sy = e.clientY, l0 = el.scrollLeft, t0 = el.scrollTop;
        this._dragMoved = false;
        el.style.cursor = "grabbing";
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (!this._dragMoved && Math.abs(dx) + Math.abs(dy) < 4) return;
          this._dragMoved = true;
          this._userPanned = true;
          el.scrollLeft = l0 - dx;
          el.scrollTop = t0 - dy;
        };
        const up = () => {
          el.style.cursor = "grab";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          setTimeout(() => { this._dragMoved = false; }, 0);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
      zoomLabel: Math.round(zoom * 100) + " %",
      zooms: [0.5, 0.75, 1].map((z) => ({
        label: Math.round(z * 100) + " %",
        style: "height:28px;padding:0 10px;white-space:nowrap;border-radius:var(--radius-sm);cursor:pointer;font:600 10px/1 var(--font-interface);letter-spacing:.09em;border:1px solid " +
          (Math.abs(z - zoom) < 0.005 ? "transparent;background:var(--color-ink-surface);color:var(--color-ink-inverse)" : "rgba(26,26,26,.2);background:var(--color-surface);color:var(--color-ink-muted)"),
        pick: () => this.setState({ zoom: z }),
      })),
      nodes, labels, links: g.links, tip, hasTip: !!tip,
      depth: this.state.depth ?? 8,
      onDepth: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ depth: +e.target.value, hover: null }),
      minGames: this.seuil,
      onSlider: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ minGames: +e.target.value, hover: null }),
      speeds,
      segWhite: seg(this.state.color === "white"), segBlack: seg(this.state.color === "black"),
      whiteCount: counts?.white, blackCount: counts?.black,
      tabPartiesStyle: tab(isParties), tabCahierStyle: tab(isCahier),
      segArbre: seg(this.state.cahierTab === "arbre"), segChap: seg(this.state.cahierTab === "chapitres"),
      killedCount: this.state.killed.length, noKilled: this.state.killed.length === 0,
      killedList: this.state.killed.map((k) => {
        const parts = k.split(" ");
        let name: string | null = null, exact = false;
        for (let i = parts.length; i > 0 && !name; i--) {
          const key = parts.slice(0, i).join(" ");
          const nk = this.nm(key);
          if (nk) { name = nk; exact = i === parts.length; }
        }
        return {
          name: name ? (exact ? name : name + " · suite") : "Ligne sans nom",
          line: parts.map((s, i) => (i % 2 === 0 ? (i / 2 + 1) + "." : "") + s).join(" "),
          revive: () => this.setState({ killed: this.state.killed.filter((x) => x !== k) }),
        };
      }),
      chapters: CHAPTERS.map((c) => ({
        ...c, badgeStyle: badgeStyle(c.badgeTone),
        barStyle: "width:" + c.pct + "%;height:100%;background:" + c.tone,
        progress: c.pct + " % écrit",
        open: () => this.setState({ view: "parties", modal: "board", boardSrc: "parties", path: c.ref.split(" "), free: [], sel: null, flash: null, startFen: null }),
      })),
      sources: SOURCES.map((s, i) => ({
        ...s,
        style: "text-align:left;padding:12px 14px;border-radius:var(--radius-sm);cursor:pointer;border:1px solid " +
          (this.state.srcPick === i ? "var(--color-primary);background:var(--tint-primary-bg)" : "rgba(0,0,0,.14);background:var(--color-surface)"),
        pick: () => this.setState({ srcPick: i }),
      })),
      board: boardV,
      boardOpen: this.state.modal === "board" || this.state.modal === "new",
      importOpen: this.state.modal === "import",
      goParties: () => this.setState({ view: "parties", hover: null }),
      goCahier: () => this.setState({ view: "cahier", hover: null }),
      cahierArbre: () => this.setState({ cahierTab: "arbre", hover: null }),
      cahierChapitres: () => this.setState({ cahierTab: "chapitres" }),
      pickWhite: () => { this.setState({ color: "white", hover: null }); this.loadParties("white"); },
      pickBlack: () => { this.setState({ color: "black", hover: null }); this.loadParties("black"); },
      openImport: () => this.setState({ modal: "import", importErr: null, importFlash: null }),
      closeImport: () => this.setState({ modal: null, importErr: null }),
      importText: this.state.importText || "",
      importErr: this.state.importErr || null,
      importFlash: this.state.importFlash || null,
      onImportText: (e: React.ChangeEvent<HTMLTextAreaElement>) => this.setState({ importText: e.target.value, importErr: null }),
      onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = ""; // permet de re-choisir le même fichier
        if (!file) return;
        file.text().then((text) => {
          const name = file.name.toLowerCase();
          if (name.endsWith(".tsv") || (text.includes("\t") && !name.endsWith(".csv"))) {
            const names = parseBookTsv(text);
            const count = Object.keys(names).length;
            if (!count) { this.setState({ importErr: "Aucun nom d'ouverture trouvé (TSV eco⇥nom⇥pgn attendu).", importFlash: null }); return; }
            this.setState({
              nameOverrides: { ...(this.state.nameOverrides || {}), ...names },
              importErr: null, importFlash: count + " noms d'ouverture importés — visibles sur la carte.",
            });
          } else if (name.endsWith(".csv") || text.includes(",")) {
            const lines = parseMoveLines(text, ",");
            if (!lines.length) { this.setState({ importErr: "Aucune ligne de coups reconnue dans ce fichier.", importFlash: null }); return; }
            const keys = lines.map((l) => l.s);
            this.setState({
              cahierLines: (this.state.cahierLines || []).concat(lines),
              cahier: Array.from(new Set(this.state.cahier.concat(keys))),
              view: "cahier", cahierTab: "arbre", modal: null, hover: null,
              importErr: null, importFlash: null,
            });
          } else {
            const free = parseLineToFree(splitPgnMoves(text));
            if (!free.length) { this.setState({ importErr: "PGN non reconnu.", importFlash: null }); return; }
            this.setState({ modal: "board", boardSrc: "parties", startFen: null, path: [], free, sel: null, flash: null, importErr: null });
          }
        });
      },
      doImport: () => {
        const text = (this.state.importText || "").trim();
        if (!text) { this.setState({ importErr: "Colle un PGN ou un FEN." }); return; }
        if (isFen(text)) {
          this.setState({ modal: "board", boardSrc: "parties", startFen: text, path: [], free: [], sel: null, flash: null, importErr: null });
          return;
        }
        const free = parseLineToFree(splitPgnMoves(text));
        if (!free.length) { this.setState({ importErr: "Texte non reconnu (PGN ou FEN attendu)." }); return; }
        this.setState({ modal: "board", boardSrc: "parties", startFen: null, path: [], free, sel: null, flash: null, importErr: null });
      },
      // --- Synchronisation des parties (Lichess / Chess.com) ---
      syncOpen: this.state.modal === "sync",
      syncSource: this.state.syncSource || "lichess",
      syncUser: this.state.syncUser || "",
      syncBusy: !!this.state.syncBusy,
      syncMsg: this.state.syncMsg || null,
      syncErr: this.state.syncErr || null,
      syncLast: this.state.metaData?.sync?.[this.state.syncSource || "lichess"]?.last_synced || null,
      syncSegLichess: seg((this.state.syncSource || "lichess") === "lichess"),
      syncSegChesscom: seg((this.state.syncSource || "lichess") === "chesscom"),
      openSync: () => {
        const src = this.state.syncSource || "lichess";
        const user = this.state.syncUser ?? (this.state.metaData?.sync?.[src]?.username ?? "");
        this.setState({ modal: "sync", syncSource: src, syncUser: user, syncMsg: null, syncErr: null });
      },
      closeSync: () => { if (!this.state.syncBusy) this.setState({ modal: null, syncErr: null }); },
      pickSyncSource: (s: Source) => this.setState({ syncSource: s, syncUser: this.state.metaData?.sync?.[s]?.username ?? this.state.syncUser ?? "", syncErr: null, syncMsg: null }),
      onSyncUser: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ syncUser: e.target.value, syncErr: null }),
      doSync: () => {
        if (this.state.syncBusy) return;
        const source = this.state.syncSource || "lichess";
        const username = (this.state.syncUser || "").trim();
        if (!username) { this.setState({ syncErr: "Entre un pseudo." }); return; }
        this.setState({ syncBusy: true, syncErr: null, syncMsg: null });
        ingestGames(source, username).then((res) => {
          this.setState({ syncBusy: false, syncMsg: res.seen + " nouvelle(s) partie(s) récupérée(s) · " + res.total + " en base." });
          fetchMeta().then((m) => this.setState({ metaData: m })).catch(() => {});
          this.loadParties(this.state.color);
        }).catch((e) => this.setState({ syncBusy: false, syncErr: String(e) }));
      },
      openNew: () => this.setState({ modal: "new", path: [], free: [], sel: null, newName: "", flash: null, startFen: null }),
      closeBoard: () => this.setState({ modal: null, flash: null }),
      clearHover: () => this.setState({ hover: null }),
      stop: (e: React.MouseEvent) => e.stopPropagation(),
    };
  }

  render() {
    const v = this.renderVals();
    const b = v.board;
    const loading = this.state.view === "parties" && !this.state.partiesTree && !this.state.apiError;
    return (
      <div className="ds-page" style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <header style={{ flex: "0 0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 16px", background: "var(--color-ink-surface)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 190 }}>
            <span style={{ font: "700 16px/1 var(--font-display)", textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-ink-inverse)" }}>Atlas</span>
            <span style={{ font: "400 11px/1 var(--font-interface)", textTransform: "uppercase", letterSpacing: ".12em", color: "rgba(253,248,232,.55)" }}>d'ouvertures</span>
          </div>
          <nav style={{ display: "flex", gap: 6 }}>
            <button onClick={v.goParties} style={css(v.tabPartiesStyle)}>Mes parties</button>
            <button onClick={v.goCahier} style={css(v.tabCahierStyle)}>Mon cahier</button>
          </nav>
          <div style={{ display: "flex", gap: 8, minWidth: 190, justifyContent: "flex-end" }}>
            <button onClick={v.openSync} title="Récupérer / actualiser mes parties" style={css("height:32px;padding:0 12px;border-radius:var(--radius-sm);border:1px solid rgba(253,248,232,.28);background:transparent;color:var(--color-ink-inverse);font:600 11px/1 var(--font-interface);letter-spacing:.1em;text-transform:uppercase;cursor:pointer")}>↻ Parties</button>
            <button onClick={v.openImport} style={css("height:32px;padding:0 12px;border-radius:var(--radius-sm);border:1px solid rgba(253,248,232,.28);background:transparent;color:var(--color-ink-inverse);font:600 11px/1 var(--font-interface);letter-spacing:.1em;text-transform:uppercase;cursor:pointer")}>Importer</button>
            <button onClick={v.openNew} style={css("height:32px;padding:0 12px;border-radius:var(--radius-sm);border:1px solid transparent;background:var(--color-primary);color:var(--color-ink-inverse);font:600 11px/1 var(--font-interface);letter-spacing:.1em;text-transform:uppercase;cursor:pointer")}>Nouvelle ouverture</button>
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {v.railClosed && (
            <div style={{ flex: "0 0 46px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "12px 0", borderRight: "var(--border-hairline)", background: "var(--color-surface)" }}>
              <button onClick={v.toggleRail} title="Déplier les réglages" style={css("width:34px;height:34px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);color:var(--color-ink);font-size:13px;cursor:pointer")}>→</button>
              <span style={{ writingMode: "vertical-rl", font: "600 11px var(--font-interface)", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--color-ink-muted)" }}>Réglages</span>
            </div>
          )}
          {v.railOpen && (
            <aside style={{ flex: "0 0 268px", padding: 16, borderRight: "var(--border-hairline)", background: "var(--color-surface)", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16 }}>
                <span className="t-eyebrow">Réglages</span>
                <button onClick={v.toggleRail} title="Replier les réglages" style={css("width:30px;height:30px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);color:var(--color-ink);font-size:13px;cursor:pointer")}>←</button>
              </div>

              {v.isParties && (
                <div>
                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Répertoire</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                    <button onClick={v.pickWhite} style={css(v.segWhite)}>Blancs · {v.whiteCount ?? "…"}</button>
                    <button onClick={v.pickBlack} style={css(v.segBlack)}>Noirs · {v.blackCount ?? "…"}</button>
                  </div>

                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Seuil d'élagage</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                    <span className="t-num">{v.minGames}</span>
                    <span className="t-caption--xs">parties mini par branche</span>
                  </div>
                  <input type="range" min={2} max={60} value={v.minGames} onChange={v.onSlider} style={{ width: "100%", accentColor: "var(--color-primary)" }} />
                  <div className="t-editorial--sm" style={{ margin: "8px 0 20px", color: "var(--color-ink-muted)" }}>Glisse à gauche pour voir le sous-bois.</div>

                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Profondeur</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                    <span className="t-num">{v.depth}</span>
                    <span className="t-caption--xs">demi-coups affichés</span>
                  </div>
                  <input type="range" min={2} max={14} value={v.depth} onChange={v.onDepth} style={{ width: "100%", accentColor: "var(--color-primary)", marginBottom: 22 }} />

                  <div className="t-eyebrow" style={{ marginBottom: 8 }}>Cadence</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22 }}>
                    {v.speeds.map((s) => (
                      <button key={s.label} onClick={s.toggle} style={css(s.style)}>{s.label}</button>
                    ))}
                  </div>

                  <div style={{ borderTop: "var(--border-hairline)", paddingTop: 14 }}>
                    <div className="t-eyebrow" style={{ marginBottom: 10 }}>Lecture de la carte</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ width: 56, height: 10, borderRadius: "var(--radius-xs)", background: "linear-gradient(90deg,#9c3b41,#ded2b4,#3f6b5c)" }} />
                      <span className="t-caption--xs">win rate</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 22, borderRadius: 11, background: "#3f6b5c", border: "1.8px solid rgba(26,26,26,.45)", font: "600 11px var(--font-mono)", color: "#fdf8e8" }}>e4</span>
                      <span className="t-caption--xs">coups des blancs — aplat</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 22, borderRadius: 11, background: "#9c3b41", boxShadow: "inset 0 0 0 3px #fdf8e8", border: "1.8px solid rgba(26,26,26,.45)", font: "600 11px var(--font-mono)", color: "#1a1a1a" }}>c5</span>
                      <span className="t-caption--xs">coups des noirs — centre clair</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ padding: "3px 7px", borderRadius: "var(--radius-sm)", background: "#1a1a1a", color: "#fdf8e8", font: "600 10px/1 var(--font-display)", letterSpacing: ".08em", textTransform: "uppercase" }}>Nom</span>
                      <span className="t-caption--xs">ouverture reconnue</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <svg width="56" height="22" style={{ display: "block" }}><circle cx="13" cy="11" r="9" fill="#ded2b4" stroke="#1a1a1a" strokeWidth="3.5" /></svg>
                      <span className="t-caption--xs">branche repliée</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <svg width="56" height="24" style={{ display: "block" }}><circle cx="13" cy="12" r="9" fill="#ded2b4" stroke="#f4a259" strokeWidth="4" /></svg>
                      <span className="t-caption--xs">dans mon cahier</span>
                    </div>
                  </div>

                  <div style={{ borderTop: "var(--border-hairline)", marginTop: 16, paddingTop: 14 }}>
                    <div className="t-eyebrow" style={{ marginBottom: 8 }}>Branches tuées · {v.killedCount}</div>
                    {v.killedList.map((k, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "var(--border-hairline-soft)" }}>
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ font: "600 12px/1.2 var(--font-display)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-ink)", textDecoration: "line-through" }}>{k.name}</span>
                          <span style={{ font: "400 11px/1.3 var(--font-mono)", color: "var(--color-ink-muted)" }}>{k.line}</span>
                        </span>
                        <button onClick={k.revive} style={css("flex:none;height:26px;padding:0 8px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);color:var(--color-ink);font:600 10px/1 var(--font-interface);letter-spacing:.09em;text-transform:uppercase;cursor:pointer")}>Rendre</button>
                      </div>
                    ))}
                    {v.noKilled && (
                      <div className="t-editorial--sm" style={{ color: "var(--color-ink-muted)" }}>Aucune branche tuée. Survole un nœud pour en écarter une.</div>
                    )}
                  </div>
                </div>
              )}

              {v.isCahier && (
                <div>
                  <div style={{ borderBottom: "var(--border-hairline)", paddingBottom: 14, marginBottom: 16 }}>
                    <div className="t-eyebrow" style={{ marginBottom: 8 }}>Lecture de l'arbre</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 22, borderRadius: 11, background: "#4a453c", border: "1.8px solid rgba(26,26,26,.45)", font: "600 11px var(--font-mono)", color: "#fdf8e8" }}>e4</span>
                      <span className="t-caption--xs">coups des blancs</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 22, borderRadius: 11, background: "#f0e6c8", border: "1.8px solid rgba(26,26,26,.45)", font: "600 11px var(--font-mono)", color: "#1a1a1a" }}>e5</span>
                      <span className="t-caption--xs">coups des noirs</span>
                    </div>
                    <div className="t-editorial--sm" style={{ color: "var(--color-ink-muted)" }}>Pas de win rate ici : ces lignes ne sont pas encore jouées.</div>
                  </div>
                  <div className="t-eyebrow" style={{ marginBottom: 8 }}>Le cahier</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "rgba(0,0,0,.06)", border: "var(--border-hairline)", borderRadius: "var(--radius-sm)", overflow: "hidden", marginBottom: 20 }}>
                    <div style={{ background: "var(--color-bg)", padding: "12px 10px" }}><div className="t-num--lg">5</div><div className="t-eyebrow">chapitres</div></div>
                    <div style={{ background: "var(--color-bg)", padding: "12px 10px" }}><div className="t-num--lg">50</div><div className="t-eyebrow">lignes</div></div>
                    <div style={{ background: "var(--color-bg)", padding: "12px 10px" }}><div className="t-num--lg" style={{ color: "var(--color-warning-ink)" }}>7</div><div className="t-eyebrow">à revoir</div></div>
                    <div style={{ background: "var(--color-bg)", padding: "12px 10px" }}><div className="t-num--lg" style={{ color: "var(--color-critical-ink)" }}>2</div><div className="t-eyebrow">trous</div></div>
                  </div>

                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Couverture des parties</div>
                  <div style={{ height: 8, borderRadius: "var(--radius-xs)", background: "rgba(26,26,26,.08)", overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ width: "64%", height: "100%", background: "var(--color-primary)" }} />
                  </div>
                  <div className="t-caption--xs" style={{ marginBottom: 22 }}>64 % de tes parties suivent une ligne du cahier.</div>

                  <div style={{ borderTop: "var(--border-hairline)", paddingTop: 14 }}>
                    <div className="t-eyebrow" style={{ marginBottom: 8 }}>Bibliothèques importées</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span className="t-body--sm">lichess/chess-openings</span><span className="t-caption--xs">3 471 pos.</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span className="t-body--sm">Italienne — Chessable</span><span className="t-caption--xs">86 lignes</span></div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Button variant="quiet" compact full onClick={v.openImport}>Importer une bibliothèque</Button>
                    </div>
                  </div>
                </div>
              )}
            </aside>
          )}

          <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 20px", borderBottom: "var(--border-hairline)" }}>
              <div>
                <h2 className="t-h2" style={{ margin: 0 }}>{v.pageTitle}</h2>
                <div className="t-caption--xs" style={{ marginTop: 2 }}>{v.pageSub}</div>
              </div>
              {v.isCahier && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={v.cahierArbre} style={css(v.segArbre)}>Arbre voulu</button>
                  <button onClick={v.cahierChapitres} style={css(v.segChap)}>Chapitres</button>
                </div>
              )}
            </div>

            {this.state.apiError && (
              <div style={{ padding: 20, color: "var(--color-critical-ink)", font: "400 13px var(--font-interface)" }}>
                Erreur API : {this.state.apiError}. L'API tourne-t-elle sur :8000 ? (uvicorn atlas.api:app)
              </div>
            )}
            {loading && !this.state.apiError && (
              <div style={{ padding: 40, color: "var(--color-ink-muted)", font: "400 14px var(--font-interface)" }}>Chargement…</div>
            )}

            {v.showGraph && !loading && !this.state.apiError && (
              <div ref={this.attachScroll} onPointerDown={v.onPanStart} style={css(v.scrollStyle)}>
                <div style={{ position: "sticky", top: 0, left: 0, zIndex: 8, display: "flex", gap: 6, padding: 8, width: "max-content" }}>
                  {v.zooms.map((z) => (
                    <button key={z.label} onClick={z.pick} style={css(z.style)}>{z.label}</button>
                  ))}
                  <span style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 10px", whiteSpace: "nowrap", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", border: "var(--border-hairline)", color: "var(--color-ink-muted)", font: "600 10px/1 var(--font-interface)", letterSpacing: ".09em" }}>{v.zoomLabel} · ⌘ molette · glisser</span>
                </div>
                <div style={css(v.canvasOuter)}>
                  <div style={css(v.canvasStyle)} onMouseLeave={v.clearHover}>
                    <svg width={v.gw} height={v.gh} style={{ display: "block", position: "absolute", inset: 0 }}>
                      {v.links.map((l, i) => (
                        <path key={i} d={l.d} fill="none" stroke={l.stroke} strokeWidth={l.w} strokeOpacity={l.op} strokeDasharray={l.dash || undefined} strokeLinecap="round" />
                      ))}
                      {v.nodes.map((n) => (
                        <g key={n.key} onMouseEnter={n.enter} onClick={n.click} onDoubleClick={n.dblClick} style={{ cursor: "pointer" }}>
                          <circle cx={n.x} cy={n.y} r={n.rHit} fill="transparent" />
                          <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} fillOpacity={n.op} stroke={n.stroke} strokeWidth={n.sw} />
                          {n.negative && (
                            <circle cx={n.x} cy={n.y} r={n.ringInner} fill="#fdf8e8" stroke="rgba(26,26,26,.2)" strokeWidth={1} />
                          )}
                        </g>
                      ))}
                    </svg>
                    {v.nodes.map((n) => (
                      <div key={"s" + n.key} style={css(n.sanStyle)}>{n.san}</div>
                    ))}
                    {v.nodes.map((n) => n.hidden ? (
                      <div key={"b" + n.key} style={css(n.badgeStyle)}>{n.badge}</div>
                    ) : null)}
                    {v.labels.map((l, i) => (
                      <div key={"l" + i} style={css(l.style)}>{l.name}</div>
                    ))}
                    {v.hasTip && v.tip && (
                      <div style={css(v.tip.style)}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, borderRadius: "8px 0 0 8px", background: v.tip.tone }} />
                        <div className="t-eyebrow">{v.tip.eyebrow}</div>
                        <div style={{ font: "600 13px/1.3 var(--font-mono)", color: "var(--color-ink)", margin: "4px 0 10px" }}>{v.tip.line}</div>
                        {v.tip.showStats && (
                          <>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                              <span className="t-num--lg">{v.tip.winrate}</span>
                              <span className="t-caption--xs">{v.tip.metricLabel}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
                              <span className="t-caption--xs">{v.tip.wdl}</span>
                              <span className="t-caption--xs">{v.tip.prob}</span>
                              <span className="t-caption--xs">{v.tip.conf}</span>
                            </div>
                          </>
                        )}
                        {v.tip.noStats && <span className="t-caption--xs">{v.tip.side}</span>}
                        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "var(--border-hairline)" }}>
                          <span style={{ font: "600 11px/1 var(--font-interface)", letterSpacing: ".09em", textTransform: "uppercase", color: "var(--color-primary-ink)" }}>{v.tip.hint}</span>
                          <span style={{ font: "600 11px/1 var(--font-interface)", letterSpacing: ".09em", textTransform: "uppercase", color: "var(--color-ink-muted)" }}>Double-clic : analyse</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {v.showChapitres && (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, background: "var(--color-desk)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16, maxWidth: 1200 }}>
                  {v.chapters.map((c, i) => (
                    <article key={i} style={{ display: "flex", background: "var(--color-surface)", border: "var(--border-hairline)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-soft)", overflow: "hidden" }}>
                      <div style={{ flex: "0 0 6px", background: c.tone }} />
                      <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                          <h3 className="t-h2" style={{ margin: 0 }}>{c.name}</h3>
                          <span style={css(c.badgeStyle)}>{c.badge}</span>
                        </div>
                        <div className="t-caption--xs" style={{ margin: "6px 0 10px" }}>{c.meta}</div>
                        <div style={{ font: "400 12px/1.4 var(--font-mono)", color: "var(--color-ink)", padding: "8px 10px", background: "var(--color-bg)", borderRadius: "var(--radius-sm)", marginBottom: 10 }}>{c.line}</div>
                        <p className="t-editorial--sm" style={{ margin: "0 0 14px" }}>{c.note}</p>
                        <div style={{ height: 6, borderRadius: "var(--radius-xs)", background: "rgba(26,26,26,.08)", overflow: "hidden", marginBottom: 6 }}>
                          <div style={css(c.barStyle)} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span className="t-caption--xs">{c.progress}</span>
                          <button onClick={c.open} style={css("height:32px;padding:0 12px;border-radius:var(--radius-sm);border:1px solid var(--color-primary);background:transparent;color:var(--color-primary-ink);font:600 11px/1 var(--font-interface);letter-spacing:.1em;text-transform:uppercase;cursor:pointer")}>Ouvrir</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  <button onClick={v.openNew} style={{ minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, border: "var(--border-dashed)", borderRadius: "var(--radius-sm)", background: "transparent", cursor: "pointer" }}>
                    <span style={{ font: "400 24px/1 var(--font-interface)", color: "var(--color-ink-muted)" }}>+</span>
                    <span className="t-eyebrow">Saisir une ouverture</span>
                    <span className="t-editorial--sm" style={{ color: "var(--color-ink-muted)", maxWidth: 220, textAlign: "center" }}>À la main, sans partir de tes parties.</span>
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>

        {v.boardOpen && (
          <div onClick={v.closeBoard} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadein .16s ease-out", zIndex: 40 }}>
            <div onClick={v.stop} style={{ width: "min(940px,100%)", maxHeight: "calc(100vh - 48px)", overflow: "auto", background: "var(--color-bg)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lift)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 18px", borderBottom: "var(--border-hairline)", background: "var(--color-surface)" }}>
                <div>
                  <div className="t-eyebrow">{b.eyebrow}</div>
                  <h3 className="t-h2" style={{ margin: "2px 0 0" }}>{b.title}</h3>
                </div>
                <button onClick={v.closeBoard} style={css("flex:none;width:34px;height:34px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);color:var(--color-ink);font-size:14px;cursor:pointer")}>✕</button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 18 }}>
                <div style={{ flex: "0 0 auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8,56px)", gridTemplateRows: "repeat(8,56px)", padding: 10, background: "#262421", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-soft)" }}>
                    {b.squares.map((sq, i) => (
                      <div key={i} style={css(sq.style)} onClick={sq.click} draggable={sq.draggable} onDragStart={sq.dragStart} onDragOver={sq.dragOver} onDrop={sq.drop}>
                        {sq.hasCoord && <span style={css(sq.coordStyle)}>{sq.coord}</span>}
                        {sq.isTarget && <span style={css(sq.targetStyle)} />}
                        <span style={css(sq.pieceStyle)}>{sq.glyph}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                    <button onClick={b.flip} style={css("height:38px;padding:0 12px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);cursor:pointer;font:600 11px/1 var(--font-interface);letter-spacing:.09em;text-transform:uppercase;color:var(--color-ink)")}>Retourner</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={b.first} style={css("width:38px;height:38px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);cursor:pointer;font-size:13px")}>⇤</button>
                    <button onClick={b.prev} style={css("width:38px;height:38px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);cursor:pointer;font-size:13px")}>←</button>
                    <button onClick={b.next} style={css("width:38px;height:38px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);cursor:pointer;font-size:13px")}>→</button>
                  </div>
                  <div className="t-caption--xs" style={{ marginTop: 8 }}>{b.plyLabel}</div>
                </div>

                <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 16 }}>
                  {b.isNew && (
                    <div>
                      <div className="t-eyebrow" style={{ marginBottom: 6 }}>Nom de l'ouverture</div>
                      <input value={b.newName} onChange={b.setName} placeholder="Attaque Jobava, ma version" style={{ width: "100%", height: 44, padding: "0 12px", boxSizing: "border-box", border: "var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--color-bg)", font: "400 14px var(--font-interface)", color: "var(--color-ink)" }} />
                      <div className="t-editorial--sm" style={{ marginTop: 8, color: "var(--color-ink-muted)" }}>Déplace les pièces une par une. Rien n'est tiré de tes parties.</div>
                    </div>
                  )}

                  {b.hasStats && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "rgba(0,0,0,.06)", border: "var(--border-hairline)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                      <div style={{ background: "var(--color-surface)", padding: 10 }}><div className="t-num">{b.n}</div><div className="t-eyebrow">parties</div></div>
                      <div style={{ background: "var(--color-surface)", padding: 10 }}><div className="t-num" style={css(b.wrStyle)}>{b.wr}</div><div className="t-eyebrow">win rate</div></div>
                      <div style={{ background: "var(--color-surface)", padding: 10 }}><div className="t-num">{b.prob}</div><div className="t-eyebrow">prob. de jeu</div></div>
                      <div style={{ background: "var(--color-surface)", padding: 10 }}><div className="t-num">{b.wilson}</div><div className="t-eyebrow">wilson bas</div></div>
                    </div>
                  )}

                  <div>
                    <div className="t-eyebrow" style={{ marginBottom: 6 }}>La ligne</div>
                    <div style={{ background: "var(--color-surface)", border: "var(--border-hairline)", borderRadius: "var(--radius-sm)", overflow: "hidden", maxHeight: 186, overflowY: "auto" }}>
                      {b.rows.map((r, i) => (
                        <div key={i} style={css(r.style)}>
                          <span style={{ flex: "0 0 34px", font: "600 11px var(--font-interface)", color: "var(--color-ink-muted)", textAlign: "right" }}>{r.no}</span>
                          <button onClick={r.wGo} style={css(r.wStyle)}>{r.w}</button>
                          <button onClick={r.bGo} style={css(r.bStyle)}>{r.b}</button>
                        </div>
                      ))}
                      {b.emptyLine && (
                        <div style={{ padding: 12 }}><span className="t-editorial--sm" style={{ color: "var(--color-ink-muted)" }}>Position de départ.</span></div>
                      )}
                    </div>
                  </div>

                  <div>
                    {b.showNext && (
                      <>
                        <div className="t-eyebrow" style={{ marginBottom: 6 }}>{b.nextLabel}</div>
                        <div style={{ display: "flex", flexDirection: "column", border: "var(--border-hairline)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                          {b.candidates.map((c, i) => (
                            <button key={i} onClick={c.play} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "none", borderBottom: "var(--border-hairline-soft)", background: "var(--color-bg)", cursor: "pointer", textAlign: "left" }}>
                              <span style={{ flex: "0 0 54px", font: "600 13px var(--font-mono)", color: "var(--color-ink)" }}>{c.san}</span>
                              <span style={{ flex: 1, minWidth: 0, height: 8, borderRadius: "var(--radius-xs)", background: "rgba(26,26,26,.08)", overflow: "hidden" }}><span style={css(c.barStyle)} /></span>
                              <span className="t-caption--xs" style={{ flex: "0 0 120px", textAlign: "right" }}>{c.meta}</span>
                            </button>
                          ))}
                          {b.noCandidates && (
                            <div style={{ padding: 12, background: "var(--color-bg)" }}>
                              <div className="t-editorial--sm" style={{ color: "var(--color-ink-muted)" }}>Plus rien ici dans tes parties. Déplace une pièce pour continuer.</div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    <div className="t-editorial--sm" style={{ marginTop: 10, color: "var(--color-ink-muted)" }}>Prends une pièce sur l'échiquier et pose-la : la ligne continue, même hors de tes parties.</div>
                    {b.offBook && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <span style={{ display: "inline-block", whiteSpace: "nowrap", font: "600 11px var(--font-interface)", letterSpacing: ".09em", textTransform: "uppercase", padding: "4px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--tint-warning-bc)", background: "var(--tint-warning-bg)", color: "var(--color-warning-ink)" }}>Hors de mes parties</span>
                        <span className="t-caption--xs">Coups posés à la main — ajoute la ligne au cahier pour la garder.</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4, borderTop: "var(--border-hairline)" }}>
                    <Button variant="primary" onClick={b.addToCahier}>{b.addLabel}</Button>
                    <Button variant="critical" onClick={b.kill}>Tuer cette branche</Button>
                    <Button variant="ghost" onClick={v.closeBoard}>Fermer</Button>
                  </div>
                  {b.flash && (
                    <div style={{ padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "var(--tint-success-bg)", border: "1px solid var(--tint-success-bc)", color: "var(--color-success-ink)", font: "400 13px var(--font-interface)" }}>{b.flashText}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {v.importOpen && (
          <div onClick={v.closeImport} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadein .16s ease-out", zIndex: 50 }}>
            <div onClick={v.stop} style={{ width: "min(560px,100%)", background: "var(--color-bg)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lift)", overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "var(--border-hairline)", background: "var(--color-surface)" }}>
                <div className="t-eyebrow">Cahier d'ouverture</div>
                <h3 className="t-h2" style={{ margin: "2px 0 0" }}>Importer une bibliothèque</h3>
              </div>
              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {v.sources.map((s, i) => (
                    <button key={i} onClick={s.pick} style={css(s.style)}>
                      <span style={{ display: "block", font: "600 14px/1.2 var(--font-interface)", color: "var(--color-ink)" }}>{s.name}</span>
                      <span style={{ display: "block", marginTop: 3, font: "400 12px/1.4 var(--font-interface)", color: "var(--color-ink-muted)" }}>{s.desc}</span>
                    </button>
                  ))}
                </div>
                <div>
                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Coller un PGN ou un FEN</div>
                  <textarea
                    value={v.importText}
                    onChange={v.onImportText}
                    rows={5}
                    placeholder={"1.e4 e5 2.Nf3 Nc6 3.Bb5 a6\n\n— ou un FEN —\n\nrnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--color-bg)", font: "400 13px/1.5 var(--font-mono)", color: "var(--color-ink)", resize: "vertical" }}
                  />
                  <div className="t-caption--xs" style={{ marginTop: 6 }}>La ligne s'ouvre dans l'échiquier ; ajoute-la ensuite au cahier.</div>
                  {v.importErr && (
                    <div className="t-caption--xs" style={{ marginTop: 6, color: "var(--color-critical-ink)" }}>{v.importErr}</div>
                  )}
                </div>
                <div style={{ borderTop: "var(--border-hairline)", paddingTop: 12 }}>
                  <div className="t-eyebrow" style={{ marginBottom: 8 }}>ou un fichier</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <span style={css("flex:none;height:36px;display:inline-flex;align-items:center;padding:0 12px;border-radius:var(--radius-sm);border:var(--border-input);background:var(--color-bg);color:var(--color-ink);font:600 11px/1 var(--font-interface);letter-spacing:.08em;text-transform:uppercase")}>Choisir un fichier…</span>
                    <input type="file" accept=".pgn,.tsv,.csv,.txt" onChange={v.onImportFile} style={{ display: "none" }} />
                    <span className="t-caption--xs">Chessable .csv · livre Lichess .tsv · PGN</span>
                  </label>
                  {v.importFlash && (
                    <div className="t-caption--xs" style={{ marginTop: 8, color: "var(--color-success-ink)" }}>{v.importFlash}</div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 6, borderTop: "var(--border-hairline)" }}>
                  <Button variant="quiet" onClick={v.closeImport}>Annuler</Button>
                  <Button variant="primary" onClick={v.doImport}>Importer</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {v.syncOpen && (
          <div onClick={v.closeSync} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadein .16s ease-out", zIndex: 50 }}>
            <div onClick={v.stop} style={{ width: "min(480px,100%)", background: "var(--color-bg)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lift)", overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "var(--border-hairline)", background: "var(--color-surface)" }}>
                <div className="t-eyebrow">Mes parties</div>
                <h3 className="t-h2" style={{ margin: "2px 0 0" }}>Récupérer mes parties</h3>
              </div>
              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Plateforme</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => v.pickSyncSource("lichess")} style={css(v.syncSegLichess)}>Lichess</button>
                    <button onClick={() => v.pickSyncSource("chesscom")} style={css(v.syncSegChesscom)}>Chess.com</button>
                  </div>
                </div>
                <div>
                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>Pseudo</div>
                  <input
                    value={v.syncUser}
                    onChange={v.onSyncUser}
                    onKeyDown={(e) => { if (e.key === "Enter") v.doSync(); }}
                    placeholder={v.syncSource === "lichess" ? "ton pseudo Lichess" : "ton pseudo Chess.com"}
                    style={{ width: "100%", height: 44, padding: "0 12px", boxSizing: "border-box", border: "var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--color-bg)", font: "400 14px var(--font-interface)", color: "var(--color-ink)" }}
                  />
                  {v.syncLast && (
                    <div className="t-caption--xs" style={{ marginTop: 6 }}>Dernière synchro : {new Date(v.syncLast).toLocaleString("fr-FR")}</div>
                  )}
                </div>
                <div className="t-editorial--sm" style={{ color: "var(--color-ink-muted)" }}>Import incrémental : seules les nouvelles parties sont téléchargées. Le premier import peut prendre un moment.</div>
                {v.syncErr && (
                  <div className="t-caption--xs" style={{ color: "var(--color-critical-ink)" }}>{v.syncErr}</div>
                )}
                {v.syncMsg && (
                  <div style={{ padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "var(--tint-success-bg)", border: "1px solid var(--tint-success-bc)", color: "var(--color-success-ink)", font: "400 13px var(--font-interface)" }}>{v.syncMsg}</div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 6, borderTop: "var(--border-hairline)" }}>
                  <Button variant="quiet" onClick={v.closeSync}>Fermer</Button>
                  <Button variant="primary" onClick={v.doSync}>{v.syncBusy ? "Récupération…" : "Récupérer"}</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}
