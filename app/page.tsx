import Link from 'next/link'

const formations = [
  {
    icon: '💻',
    title: 'Compétences numériques',
    description:
      'Découvrez les outils numériques et améliorez votre maîtrise des technologies utiles à vos projets.',
    link: '/formations',
  },
  {
    icon: '🤖',
    title: 'Intelligence artificielle',
    description:
      "Apprenez à utiliser l'intelligence artificielle pour développer vos idées et gagner en productivité.",
    link: '/formations',
  },
  {
    icon: '📈',
    title: 'Entrepreneuriat digital',
    description:
      'Découvrez des méthodes pour structurer vos idées et développer vos activités en ligne.',
    link: '/formations',
  },
]

const espaces = [
  {
    icon: '📚',
    title: 'Mes formations',
    description: 'Suivez vos apprentissages.',
    link: '/compte/formations',
  },
  {
    icon: '📊',
    title: 'Ma progression',
    description: 'Suivez votre évolution.',
    link: '/compte',
  },
  {
    icon: '🏆',
    title: 'Mes certificats',
    description: 'Retrouvez vos réussites.',
    link: '/compte/certificats',
  },
  {
    icon: '👤',
    title: 'Mon profil',
    description: 'Gérez votre espace personnel.',
    link: '/compte',
  },
]

export default function Home() {
  return (
    <div className="dda-home">

      {/* ACCUEIL */}
      <section className="dda-hero" id="accueil">
        <div className="dda-container dda-hero-grid">

          <div>
            <span className="dda-badge">
              PLATEFORME DIGITALE DE FORMATION
            </span>

            <h1>
              Apprenez.
              <br />
              Créez.
              <br />
              Développez.
              <br />
              Réussissez.
            </h1>

            <p>
              Bienvenue sur DORA DIGITAL ACADEMY, votre espace numérique
              pour apprendre, développer vos compétences et transformer
              vos idées en projets concrets.
            </p>

            <div className="dda-buttons">
              <Link href="/formations" className="dda-btn dda-btn-primary">
                Découvrir les formations
              </Link>

              <Link href="/boutique" className="dda-btn dda-btn-secondary">
                Explorer la bibliothèque
              </Link>
            </div>
          </div>

          <div className="dda-hero-card">
            <h3>Votre réussite commence ici</h3>

            <div className="dda-stat">
              <strong>01</strong>
              <span>Développez vos compétences</span>
            </div>

            <div className="dda-stat">
              <strong>02</strong>
              <span>Apprenez à votre rythme</span>
            </div>

            <div className="dda-stat">
              <strong>03</strong>
              <span>Concrétisez vos projets</span>
            </div>
          </div>

        </div>
      </section>

      {/* FORMATIONS */}
      <section className="dda-section" id="formations">
        <div className="dda-container">

          <div className="dda-section-title">
            <h2>Nos formations</h2>
            <p>
              Développez vos compétences et préparez votre avenir.
            </p>
          </div>

          <div className="dda-features">
            {formations.map((item) => (
              <article className="dda-card" key={item.title}>
                <div className="dda-icon">{item.icon}</div>

                <h3>{item.title}</h3>

                <p>{item.description}</p>

                <Link href={item.link} className="dda-card-link">
                  Découvrir →
                </Link>
              </article>
            ))}
          </div>

        </div>
      </section>

      {/* BIBLIOTHÈQUE */}
      <section className="dda-section dda-library" id="bibliotheque">
        <div className="dda-container">

          <div className="dda-section-title">
            <h2>Notre bibliothèque</h2>
            <p>
              Des ressources pour apprendre, créer et progresser.
            </p>
          </div>

          <div className="dda-ebook">

            <div className="dda-ebook-cover">
              <strong>IA</strong>
              <h3>1 300+ PROMPTS IA</h3>
              <p>Pour le business et la productivité</p>
            </div>

            <div className="dda-ebook-info">
              <h2>Développez vos idées avec l'IA</h2>

              <p>
                Explorez des ressources pratiques pour découvrir
                de nouvelles possibilités avec l'intelligence
                artificielle.
              </p>

              <Link href="/boutique" className="dda-btn dda-btn-primary">
                Voir la boutique d'eBooks
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* BOUTIQUE */}
      <section className="dda-section dda-store" id="boutique">
        <div className="dda-container">

          <div className="dda-section-title">
            <h2>Boutique d'eBooks</h2>
            <p>
              Découvrez nos livres numériques et nos ressources pratiques.
            </p>
          </div>

          <div className="dda-store-box">
            <div className="dda-store-icon">📚</div>

            <h3>Votre bibliothèque numérique</h3>

            <p>
              Retrouvez nos ressources, consultez les descriptions
              et découvrez les produits disponibles.
            </p>

            <Link href="/boutique" className="dda-btn dda-btn-primary">
              Accéder à la boutique
            </Link>
          </div>

        </div>
      </section>

      {/* ESPACE APPRENANT */}
      <section className="dda-section dda-dashboard" id="espace">
        <div className="dda-container">

          <div className="dda-section-title">
            <h2>Mon espace apprenant</h2>
            <p>
              Retrouvez les principales fonctionnalités de votre
              parcours d'apprentissage.
            </p>
          </div>

          <div className="dda-dashboard-grid">
            {espaces.map((item) => (
              <Link
                href={item.link}
                className="dda-dashboard-item"
                key={item.title}
              >
                <span>{item.icon}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </Link>
            ))}
          </div>

          <div className="dda-account-panel">
            <h3>Votre compte et vos achats</h3>

            <p>
              Connectez-vous pour consulter vos achats et retrouver
              vos ressources numériques.
            </p>

            <div className="dda-buttons">
              <Link href="/connexion" className="dda-btn dda-btn-primary">
                Se connecter
              </Link>

              <Link href="/inscription" className="dda-btn dda-btn-secondary">
                Créer un compte
              </Link>

              <Link href="/compte/commandes" className="dda-btn dda-btn-secondary">
                Mes commandes
              </Link>
            </div>
          </div>

        </div>
      </section>

      {/* APPEL À L'ACTION */}
      <section className="dda-cta">
        <div className="dda-container">

          <h2>Prêt à commencer ?</h2>

          <p>
            Faites le premier pas vers de nouvelles compétences
            et donnez vie à vos projets.
          </p>

          <Link href="/formations" className="dda-btn dda-btn-light">
            Explorer les formations
          </Link>

        </div>
      </section>

    </div>
  )
}
