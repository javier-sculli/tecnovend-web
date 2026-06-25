async function run() {
  const token = 'APP_USR-7511523222718880-052619-c857d170cb4de1e7efac0c2b10339257-44290815';

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [
        {
          title: 'Prueba - Producto de Vending',
          description: 'Prueba desde máquina 001',
          unit_price: 150,
          quantity: 1,
          currency_id: 'ARS'
        }
      ],
      external_reference: 'machine_001'
    })
  });
  const data = await res.json();
  console.log('Link de Pago (Checkout Pro):');
  console.log(data.init_point);
}

run().catch(console.error);
