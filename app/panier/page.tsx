'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';

export default function Cart() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');

    const { data, error } = await supabase().rpc('get_my_cart');

    if (error) {
      setMessage(error.message);
      setItems([]);
    } else {
      // Supabase renvoie un objet contenant la liste dans data.items.
      const cartItems = Array.isArray(data?.items) ? data.items : [];
      setItems(cartItems);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function update(id: string, q: number) {
    if (q < 1) {
      await remove(id);
      return;
    }

    const { error } = await supabase()
      .from('cart_items')
      .update({ quantity: q })
      .eq('id', id);

    if (error) {
      setMessage(error.message);
    } else {
      await load();
    }
  }

  async function remove(id: string) {
    const { error } = await supabase()
      .from('cart_items')
      .delete()
      .eq('id', id);

    if (error) {
      setMessage(error.message);
    } else {
      await load();
    }
  }

  const total = useMemo(
    () => items.reduce((s, x) => s + Number(x.subtotal || 0), 0),
    [items]
  );

  async function checkout() {
    setMessage('');

    const { data, error } = await supabase().rpc('create_cart_order', {
      p_coupon_code: null,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data) {
      window.location.href = `/paiement?order=${data}`;
    } else {
      setMessage('Aucune commande n’a été retournée.');
    }
  }

  return (
    <main
      className="container"
      style={{ maxWidth: 900, paddingTop: 40, paddingBottom: 80 }}
    >
      <div className="account-head">
        <div>
          <span className="eyebrow">DORA DIGITAL ACADEMY</span>
          <h1>Mon panier</h1>
        </div>

        <Link className="btn" href="/boutique">
          ← Continuer mes achats
        </Link>
      </div>

      {loading ? (
        <div className="notice">Chargement…</div>
      ) : !items.length ? (
        <div className="notice">
          Votre panier est vide.
          <br />
          <Link href="/boutique">Découvrir la boutique</Link>
        </div>
      ) : (
        <>
          <div className="grid">
            {items.map((x) => (
              <div className="card" key={x.id}>
                <h2>{x.title}</h2>

                <p>
                  {Number(x.unit_price).toLocaleString('fr-FR')} {x.currency} ×{' '}
                  {x.quantity}
                </p>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <button onClick={() => update(x.id, x.quantity - 1)}>
                    −
                  </button>

                  <strong>{x.quantity}</strong>

                  <button onClick={() => update(x.id, x.quantity + 1)}>
                    +
                  </button>

                  <button
                    onClick={() => remove(x.id)}
                    style={{ marginLeft: 'auto' }}
                  >
                    Supprimer
                  </button>
                </div>

                <div className="price" style={{ marginTop: 12 }}>
                  {Number(x.subtotal).toLocaleString('fr-FR')} {x.currency}
                </div>
              </div>
            ))}
          </div>

          <section className="card" style={{ marginTop: 20 }}>
            <h2>Total</h2>

            <div className="price">
              {total.toLocaleString('fr-FR')} XAF
            </div>

            <button onClick={checkout} style={{ marginTop: 16 }}>
              Passer au paiement
            </button>
          </section>
        </>
      )}

      {message && (
        <p className="notice" style={{ marginTop: 16 }}>
          {message}
        </p>
      )}
    </main>
  );
}