import Link from 'next/link'

export default function Home(){return <>
  <section className="hero">
    <p className="eyebrow">DORA DIGITAL ACADEMY</p>
    <h1>Apprenez. Créez.<br/>Développez. Réussissez.</h1>
    <p>Une académie numérique francophone pour développer vos compétences, exploiter l’IA et transformer vos idées en projets concrets.</p>
    <div className="hero-actions"><Link className="btn" href="/boutique">Explorer la boutique</Link><Link className="btn secondary" href="/formations">Voir les formations</Link></div>
  </section>
  <section className="grid" aria-label="Nos domaines">
    <div className="card"><h2>🤖 IA & Prompts</h2><p>Des ressources prêtes à l’emploi pour utiliser l’intelligence artificielle efficacement.</p></div>
    <div className="card"><h2>🎓 Formations</h2><p>Des parcours pratiques, une progression suivie et des certificats de réussite.</p></div>
    <div className="card"><h2>💼 Business & Marketing</h2><p>Guides, méthodes et outils pour structurer et développer vos activités.</p></div>
  </section>
  <section className="card" style={{marginTop:24,textAlign:'center'}}><h2>Votre prochaine compétence commence ici.</h2><p>Accédez à des contenus conçus pour apprendre rapidement et passer à l’action.</p><Link className="btn" href="/boutique">Commencer maintenant</Link></section>
</>}
