import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import BillPage from './BillPage';

export default function Search() {
  const navigate = useNavigate();
  const [billNumber, setBillNumber] = useState('');
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState('');
  const [stores, setStores] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingBill, setEditingBill] = useState(null);
  const [paidInputs, setPaidInputs] = useState({});
  const [savingBillId, setSavingBillId] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get('/api/stores');
        setStores(res.data.stores || []);
      } catch {}
    })();
  }, []);

  // Close modal on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setEditingBill(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const search = async () => {
    try {
      setLoading(true);
      setError('');
      const params = {};
      if (billNumber) params.billNumber = billNumber;
      if (storeId) params.storeId = storeId;
      if (date) params.date = date;

      const res = await axios.get('/api/bills/search', { params });
      const bills = res.data.bills || [];
      setResults(bills);

      const map = {};
      bills.forEach(b => (map[b._id] = ''));
      setPaidInputs(map);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPayment = async (id) => {
    try {
      setSavingBillId(id);
      const toAdd = Number(paidInputs[id]);
      if (isNaN(toAdd) || toAdd <= 0) {
        alert('Enter valid amount');
        return;
      }

      const bill = results.find(b => b._id === id);
      if (!bill) return;

      if (toAdd > bill.pendingAmount) {
        alert('Amount exceeds pending');
        return;
      }

      const newPaid = bill.paidAmount + toAdd;
      await axios.patch(`/api/bills/${id}/paid`, { paidAmount: newPaid });
      await search();
      setPaidInputs(prev => ({ ...prev, [id]: '' }));
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setSavingBillId('');
    }
  };

  /* ===== DATE WISE TOTAL ===== */
  const dayTotals = results.reduce(
    (acc, bill) => {
      acc.grandTotal += Number(bill.grandTotal || 0);
      acc.paidTotal += Number(bill.paidAmount || 0);
      acc.pendingTotal += Number(bill.pendingAmount || 0);
      return acc;
    },
    { grandTotal: 0, paidTotal: 0, pendingTotal: 0 }
  );

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button className="px-3 py-1 bg-gray-200 rounded" onClick={() => navigate(-1)}>← Back</button>
          <h1 className="text-2xl font-bold">Search Bills</h1>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded shadow">
          <div className="grid md:grid-cols-4 gap-3">
            <input className="input" type="number" placeholder="Bill number" value={billNumber} onChange={e => setBillNumber(e.target.value)} />
            <select className="input" value={storeId} onChange={e => setStoreId(e.target.value)}>
              <option value="">All stores</option>
              {stores.map(s => (
                <option value={s.storeId} key={s.storeId}>{s.name}</option>
              ))}
            </select>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={search}>Search</button>
          </div>
        </div>

        {loading && <div className="mt-4">Loading...</div>}
        {error && <div className="mt-4 text-red-600">{error}</div>}

        {/* ===== DAY TOTAL DISPLAY ===== */}
        {date && results.length > 0 && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-4">
            <h2 className="font-semibold text-lg mb-2">
              Total for {new Date(date).toLocaleDateString()}
            </h2>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white p-3 rounded shadow">
                <div className="text-gray-500">Total Amount</div>
                <div className="font-bold">₹{dayTotals.grandTotal.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded shadow">
                <div className="text-gray-500">Total Paid</div>
                <div className="font-bold text-green-700">₹{dayTotals.paidTotal.toFixed(2)}</div>
              </div>
              <div className="bg-white p-3 rounded shadow">
                <div className="text-gray-500">Total Pending</div>
                <div className="font-bold text-red-700">₹{dayTotals.pendingTotal.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ===== RESULTS ===== */}
        <div className="mt-4 space-y-3">
          {results.map(b => (
            <div key={b._id} className="bg-white p-4 rounded shadow">
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold">Bill #{b.billNumber}</div>
                  <div className="text-xs text-gray-500">{new Date(b.date).toLocaleString()}</div>
                </div>
                <div className="text-right text-sm">
                  <div>Store: {b.store?.name || '—'}</div>
                  <div>Total: ₹{(b.grandTotal || 0).toFixed(2)}</div>
                  <div className="flex items-center gap-2 justify-end">
                    <input
                      type="number"
                      min={0}
                      className="border rounded px-2 py-1 w-28"
                      value={paidInputs[b._id] ?? ''}
                      placeholder={`₹${(b.paidAmount || 0).toFixed(2)}`}
                      onChange={e => setPaidInputs({ ...paidInputs, [b._id]: e.target.value })}
                    />
                    <button
                      className="px-2 py-1 bg-green-600 text-white rounded disabled:opacity-60"
                      disabled={savingBillId === b._id || (b.pendingAmount || 0) <= 0}
                      onClick={() => handleAddPayment(b._id)}
                    >Add</button>
                    <button
                      className="px-2 py-1 bg-yellow-600 text-white rounded"
                      onClick={() => setEditingBill(b)}
                    >Edit</button>
                  </div>
                  <div className="font-semibold">Pending: ₹{(b.pendingAmount || 0).toFixed(2)}</div>
                </div>
              </div>

              {/* ✅ PRODUCTS LIST RESTORED */}
              <div className="mt-2 text-sm">
                <ul className="list-disc pl-5">
                  {b.products.map((p, i) => (
                    <li key={i}>
                      {p.productName} ({p.productCode || '—'}): {p.quantity} × ₹{p.price} → ₹{(p.finalPrice || 0).toFixed(2)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}

          {!loading && results.length === 0 && (
            <div className="text-gray-600">No results.</div>
          )}
        </div>
      </div>

      {/* ===== MODAL ===== */}
      {editingBill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={() => setEditingBill(null)}
        >
          <div
            className="bg-white rounded-lg shadow-lg w-full max-w-3xl p-4 relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="absolute top-3 right-3 px-3 py-1 bg-gray-200 rounded"
              onClick={() => setEditingBill(null)}
            >
              Close
            </button>

            <BillPage
              defaultStoreName={editingBill.store?.name || ''}
              bill={editingBill}
              onSaved={() => {
                setEditingBill(null);
                search();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
