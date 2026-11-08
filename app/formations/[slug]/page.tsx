'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

export default function Course() {
  const p = useParams();
  const router = useRouter();

  const [c, setC] = useState<any>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase()
      .from('courses')
      .select('*')
      .eq('slug', p.slug)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('Erreur de chargement de la formation :', error);
          return;
        }

        setC(data);
      });
  }, [p.slug]);

  async function enroll() {
    if (!c) return;

    setBusy(true);

    const s = supabase();

    const {
      data: { user },
    } = await s.auth.getUser();

    if (!user) {
      setBusy(false);
      router.push('/connexion');
      return;
    }

    const { data: existing, error: enrollmentError } = await s
      .from('enrollments')
      .select('id')
      .eq('user_id', user.id)
      .eq('course_id', c.id)
      .maybeSingle();

    if (enrollmentError) {
      console.error('Erreur de vérification de l’inscription :', enrollmentError);
      alert(`Erreur d'inscription : ${enrollmentError.message}`);
      setBusy(false);
      return;
    }

    if (existing) {
      router.push(`/apprentissage/${c.id}`);
      return;
    }

    const { data: order, error } = await s.rpc(
      'create_product_order',
      { p_product_id: c.id }
    );

    if (error) {
      console.error('Erreur create_product_order :', error);
      alert(`Erreur lors de la création de la commande : ${error.message}`);
      setBusy(false);
      return;
    }

    if (!order) {
      console.error('Aucun identifiant de commande retourné par Supabase.');
      alert('La commande n’a pas été créée. Veuillez réessayer.');
      setBusy(false);
      return;
    }

  router.push(`/paiement?order=${order.id}`);
  }

  return (
    <main>
      {c && (
        <div className="card">
          <h1>{c.title}</h1>

          <p>{c.description}</p>

          <p>
            {c.level} · {c.duration_minutes} minutes
          </p>

          <div className="price">
            {Number(c.sale_price ?? c.price).toLocaleString('fr-FR')}{' '}
            {c.currency}
          </div>

          <button
            className="button"
            disabled={busy}
            onClick={enroll}
          >
            {busy ? 'Chargement…' : 'S’inscrire à la formation'}
          </button>
        </div>
      )}
    </main>
  );
}