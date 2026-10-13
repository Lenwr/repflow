import { useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import "./muscle-atlas.css";
import "./muscle-atlas-detailed.css";

export const muscleNames = {
  pectoraux: "Pectoraux", épaules: "Épaules", biceps: "Biceps", triceps: "Triceps",
  "avant-bras": "Avant-bras", abdominaux: "Abdominaux", dorsaux: "Dorsaux",
  trapèzes: "Trapèzes", lombaires: "Lombaires", fessiers: "Fessiers",
  quadriceps: "Quadriceps", "ischio-jambiers": "Ischio-jambiers", adducteurs: "Adducteurs", mollets: "Mollets",
};
type Zone = keyof typeof muscleNames;
export type AtlasItem = { zone: Zone; primary: boolean; count: number };
const hotspots: Array<{ zone: Zone; paths: string[] }> = [
  { zone: "pectoraux", paths: ["M171 293 C208 276 254 282 294 311 L294 383 C244 393 191 371 169 330Z", "M306 311 C346 282 392 276 429 293 L431 330 C409 371 356 393 306 383Z"] },
  { zone: "épaules", paths: ["M119 292 C134 267 174 263 202 287 C211 307 202 347 178 369 C146 366 119 339 119 292Z", "M398 287 C426 263 466 267 481 292 C481 339 454 366 422 369 C398 347 389 307 398 287Z", "M559 296 C577 269 620 266 650 291 C660 316 648 350 621 367 C589 363 563 340 559 296Z", "M850 291 C880 266 923 269 941 296 C937 340 911 363 879 367 C852 350 840 316 850 291Z"] },
  { zone: "biceps", paths: ["M127 366 C150 348 176 366 180 402 L169 469 C151 489 128 472 121 439Z", "M420 402 C424 366 450 348 473 366 L479 439 C472 472 449 489 431 469Z"] },
  { zone: "triceps", paths: ["M577 358 C599 338 630 352 642 390 L635 469 C619 489 594 478 581 447Z", "M858 390 C870 352 901 338 923 358 L919 447 C906 478 881 489 865 469Z"] },
  { zone: "avant-bras", paths: ["M90 450 C111 431 144 444 159 474 L143 563 C127 590 98 578 84 552Z", "M441 474 C456 444 489 431 510 450 L516 552 C502 578 473 590 457 563Z", "M548 459 C569 440 600 447 616 478 L603 565 C586 590 559 579 545 550Z", "M884 478 C900 447 931 440 952 459 L955 550 C941 579 914 590 897 565Z"] },
  { zone: "abdominaux", paths: ["M245 382 C263 367 337 367 355 382 L354 561 C339 598 319 617 300 616 C281 617 261 598 246 561Z"] },
  { zone: "trapèzes", paths: ["M676 192 C703 164 807 164 834 192 L838 296 C814 326 786 339 755 340 C724 339 696 326 672 296Z"] },
  { zone: "dorsaux", paths: ["M625 340 C665 325 715 347 747 391 L742 527 C692 535 647 499 620 444Z", "M763 391 C795 347 845 325 885 340 L890 444 C863 499 818 535 768 527Z"] },
  { zone: "lombaires", paths: ["M704 501 C729 486 781 486 806 501 L817 627 C793 654 717 654 693 627Z"] },
  { zone: "fessiers", paths: ["M631 607 C661 581 722 585 755 620 L753 720 C716 750 656 739 628 703Z", "M755 620 C788 585 849 581 879 607 L882 703 C854 739 794 750 757 720Z"] },
  { zone: "quadriceps", paths: ["M161 594 C198 565 244 579 263 622 L256 756 C243 805 211 828 178 803 C153 755 148 660 161 594Z", "M337 622 C356 579 402 565 439 594 C452 660 447 755 422 803 C389 828 357 805 344 756Z"] },
  { zone: "adducteurs", paths: ["M266 594 C285 578 315 578 334 594 L340 704 C327 738 311 755 300 756 C289 755 273 738 260 704Z"] },
  { zone: "ischio-jambiers", paths: ["M637 722 C668 697 711 704 738 739 L730 875 C710 913 676 919 650 888 C631 843 626 767 637 722Z", "M772 739 C799 704 842 697 873 722 C884 767 879 843 860 888 C834 919 800 913 780 875Z"] },
  { zone: "mollets", paths: ["M157 821 C184 802 223 815 238 852 L231 1003 C215 1052 184 1059 160 1020 C145 967 143 872 157 821Z", "M362 852 C377 815 416 802 443 821 C457 872 455 967 440 1020 C416 1059 385 1052 369 1003Z", "M625 844 C652 820 694 831 713 871 L707 1026 C687 1062 655 1061 631 1020 C617 969 613 887 625 844Z", "M797 871 C816 831 858 820 885 844 C897 887 893 969 879 1020 C855 1061 823 1062 803 1026Z"] },
];

export function MuscleAtlas({ items, selected, onSelect, guide = false }: { items: AtlasItem[]; selected: Zone | null; onSelect: (zone: Zone | null) => void; guide?: boolean }) {
  const [sex, setSex] = useState<"homme" | "femme">("homme");
  const [zoom, setZoom] = useState(1);
  const select = (zone: Zone) => onSelect(selected === zone ? null : zone);
  const selectedItem = selected ? items.find((item) => item.zone === selected) : null;
  return <section className="atlas anatomy-atlas">
    <header><div><span className="eyebrow">ATLAS MUSCULAIRE</span><h2>{guide ? "Explorer par muscle" : "Muscles de la séance"}</h2><p>Touchez directement une zone anatomique pour afficher les exercices associés.</p></div>
      <div className="atlas-switch" role="group" aria-label="Représentation">{(["homme", "femme"] as const).map((value) => <button type="button" key={value} aria-pressed={sex === value} onClick={() => setSex(value)}>{value === "homme" ? "Homme" : "Femme"}</button>)}</div>
    </header>
    <div className="atlas-layout"><div className="atlas-stage">
      <div className="atlas-zoom" role="group" aria-label="Zoom du schéma"><button type="button" onClick={() => setZoom((value) => Math.max(1, value - .25))} aria-label="Réduire"><Minus /></button><button type="button" onClick={() => setZoom(1)} aria-label="Réinitialiser le zoom"><Maximize2 /></button><button type="button" onClick={() => setZoom((value) => Math.min(2, value + .25))} aria-label="Agrandir"><Plus /></button></div>
      <div className="atlas-canvas-scroll"><div className="atlas-canvas" style={{ width: `${zoom * 100}%` }}>
        <img src={sex === "homme" ? "/images/guides/muscle-groups.png" : "/images/guides/muscle-groups-female.png"} alt={`Atlas musculaire ${sex}, vues avant et arrière`} />
        <svg viewBox="0 0 1024 1536" aria-label="Zones musculaires interactives">{hotspots.map(({ zone, paths }) => { const item = items.find((entry) => entry.zone === zone); return <g key={zone} role="button" tabIndex={item ? 0 : -1} aria-label={muscleNames[zone]} aria-pressed={selected === zone} aria-disabled={!item} className={`atlas-hotspot ${item ? item.primary ? "target" : "support" : "inactive"} ${selected === zone ? "chosen" : ""}`} onClick={() => item && select(zone)} onKeyDown={(event) => { if (item && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); select(zone); } }}><title>{muscleNames[zone]}</title>{paths.map((path, index) => <path key={index} d={path} />)}</g>; })}</svg>
      </div></div><p className="atlas-caption">{selected ? muscleNames[selected] : "Touchez une zone colorée"}</p>
    </div><div className="atlas-panel">
      {selected && <div className="atlas-selection"><span>Muscle sélectionné</span><strong>{muscleNames[selected]}</strong><small>{selectedItem?.count ?? 0} exercice{(selectedItem?.count ?? 0) > 1 ? "s" : ""} associé{(selectedItem?.count ?? 0) > 1 ? "s" : ""}</small></div>}
      <button type="button" className="atlas-reset" onClick={() => onSelect(null)} aria-pressed={!selected}>Tous les muscles</button>
      {!guide && <p className="atlas-legend"><span>Cible principale</span><span>Muscle secondaire</span></p>}
      <div className="atlas-muscles">{items.map((item) => <button type="button" key={item.zone} data-zone={item.zone} aria-pressed={selected === item.zone} onClick={() => select(item.zone)}><i/><span><b>{muscleNames[item.zone]}</b><small>{guide ? "Voir les exercices" : item.primary ? "Cible principale" : "Muscle secondaire"}</small></span><em>{item.count} exo{item.count > 1 ? "s" : ""}</em></button>)}</div>
      {!items.length && <p>Aucun muscle identifié pour ces exercices.</p>}
      <p className="atlas-note">{guide ? "Le nombre indique les exercices du catalogue associés." : "Les zones indiquent les muscles ciblés par les exercices de cette séance."}</p>
    </div></div>
  </section>;
}
