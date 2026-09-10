import { useEffect, useState } from "react";
import { Icicle, type LaidNode } from "./Icicle";
import { sanLine, rawScore } from "./encode";
import { fetchMeta, fetchTree, FLOOR, type Color, type Meta, type TreeResponse } from "./api";

const W = 1200;
const H = 640;

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [color, setColor] = useState<Color>("white");
  const [minGames, setMinGames] = useState(6);
  const [data, setData] = useState<TreeResponse | null>(null);
  const [hovered, setHovered] = useState<LaidNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMeta().then(setMeta).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    setError(null);
    setHovered(null);
    fetchTree(color).then(setData).catch((e) => setError(String(e)));
  }, [color]);

  useEffect(() => setHovered(null), [minGames]);

  return (
    <div className="app">
      <aside className="side">
        <h1>Atlas d'ouvertures</h1>

        <div className="ctl">
          <label>Répertoire</label>
          <div className="seg">
            {(["white", "black"] as Color[]).map((c) => (
              <button
                key={c}
                className={c === color ? "on" : ""}
                onClick={() => setColor(c)}
              >
                {c === "white" ? "Blancs" : "Noirs"}
                {meta && ` (${meta.counts_by_color[c] ?? 0})`}
              </button>
            ))}
          </div>
        </div>

        <div className="ctl">
          <label>
            Seuil d'élagage : <b>{minGames}</b> parties mini par branche
          </label>
          <input
            type="range"
            min={FLOOR}
            max={40}
            value={minGames}
            onChange={(e) => setMinGames(+e.target.value)}
          />
          <small>Glisse vers la gauche pour révéler ton sous-bois d'expérimentations.</small>
        </div>

        <Legend />
        <Info hovered={hovered} rootScore={data ? rawScore(data.tree) : 0.5} />

        {data && (
          <div className="stat">
            {data.meta.total_games} parties · {color === "white" ? "Blancs" : "Noirs"}
          </div>
        )}
        {error && <div className="err">Erreur : {error}. L'API tourne-t-elle sur :8000 ?</div>}
      </aside>

      <main className="canvas">
        {data ? (
          <Icicle tree={data.tree} minGames={minGames} width={W} height={H} onHover={setHovered} />
        ) : (
          !error && <div className="loading">Chargement…</div>
        )}
      </main>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div>
        <span className="lg-label">Performance</span>
        <div className="grad" />
        <div className="grad-ends">
          <span>sous ta moyenne</span>
          <span>au-dessus</span>
        </div>
      </div>
      <div className="lg-row">
        <span className="lg-label">Confiance</span>
        <span className="op op-lo" /> peu de parties &nbsp;→&nbsp; <span className="op op-hi" /> beaucoup
      </div>
      <div className="lg-row">
        <span className="lg-label">Trait</span>
        <span className="brd-mine" /> tes coups &nbsp;·&nbsp; <span className="brd-opp" /> l'adversaire
        &nbsp;·&nbsp; <span className="transpo" /> transposition
      </div>
    </div>
  );
}

function Info({ hovered, rootScore }: { hovered: LaidNode | null; rootScore: number }) {
  if (!hovered) {
    return <div className="info muted">Survole une case pour voir la ligne et les stats.</div>;
  }
  const d = hovered.data;
  const line = sanLine(hovered);
  const ply = d.ply;
  const moveNo = Math.floor(ply / 2) + 1;
  const mover = ply % 2 === 0 ? "Blancs" : "Noirs";
  const score = rawScore(d);
  return (
    <div className="info">
      <div className="line">{formatLine(line)}</div>
      <div className="who">
        Coup {moveNo} ({mover}) · {d.is_my_move ? "ton coup" : "coup adverse"}
        {d.transposition && " · transposition"}
      </div>
      <table>
        <tbody>
          <tr><td>Parties</td><td>{d.n}</td></tr>
          <tr><td>V / N / D</td><td>{d.wins} / {d.draws} / {d.losses}</td></tr>
          <tr>
            <td>Score brut</td>
            <td>{(score * 100).toFixed(0)}% {score >= rootScore ? "▲" : "▼"}</td>
          </tr>
          <tr><td>Wilson (bas)</td><td>{(d.wilson_lower * 100).toFixed(0)}%</td></tr>
          {d.dispersion != null && (
            <tr><td>Dispersion</td><td>{d.dispersion.toFixed(2)} bits</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatLine(sans: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.`);
    out.push(sans[i]);
  }
  return out.join(" ");
}
