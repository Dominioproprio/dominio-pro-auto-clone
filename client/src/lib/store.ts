/**
 * store.ts — Gerenciamento de estado e persistência de dados.
 * Implementação simplificada para suportar o Agente IA.
 */

// --- Tipos ---

export interface Client {
  id: number;
  name: string;
  phone?: string;
  email?: string;
}

export interface Service {
  id: number;
  name: string;
  price: number;
  durationMinutes: number;
  active: boolean;
}

export interface Employee {
  id: number;
  name: string;
  active: boolean;
}

export interface Appointment {
  id: number;
  clientId: number;
  clientName: string;
  employeeId: number;
  employeeName: string;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'confirmed' | 'cancelled' | 'completed';
  services: Array<{ serviceId: number; name: string }>;
}

export interface CashEntry {
  id: number;
  amount: number;
  type: 'in' | 'out';
  description: string;
  createdAt: string;
}

// --- Stores ---

const createStore = <T extends { id: number }>(key: string) => {
  const getItems = (): T[] => {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  };

  const setItems = (items: T[]) => {
    localStorage.setItem(key, JSON.stringify(items));
  };

  return {
    list: (activeOnly = false) => {
      const items = getItems();
      if (activeOnly) {
        return items.filter((item: any) => item.active !== false);
      }
      return items;
    },
    get: (id: number) => getItems().find(i => i.id === id),
    create: async (data: Omit<T, 'id'>) => {
      const items = getItems();
      const newItem = { ...data, id: Date.now() } as T;
      setItems([...items, newItem]);
      return newItem;
    },
    update: async (id: number, data: Partial<T>) => {
      const items = getItems();
      const index = items.findIndex(i => i.id === id);
      if (index === -1) throw new Error("Item não encontrado");
      items[index] = { ...items[index], ...data };
      setItems(items);
      return items[index];
    },
    remove: async (id: number) => {
      const items = getItems();
      setItems(items.filter(i => i.id !== id));
    }
  };
};

export const clientsStore = createStore<Client>("salon_clients");
export const servicesStore = createStore<Service>("salon_services");
export const employeesStore = createStore<Employee>("salon_employees");
export const appointmentsStore = {
  ...createStore<Appointment>("salon_appointments"),
  list: (filter?: { date?: string }) => {
    const items = createStore<Appointment>("salon_appointments").list();
    if (filter?.date) {
      return items.filter(a => a.startTime.startsWith(filter.date!));
    }
    return items;
  }
};
export const cashEntriesStore = createStore<CashEntry>("salon_cash_entries");

/** Função auxiliar para carregar todos os dados (usada no App.tsx) */
export const fetchAllData = async () => {
  // Em uma implementação real, isso buscaria do backend
  return { ok: true };
};

/** Função auxiliar para abrir caixa automaticamente */
export const autoOpenCashIfNeeded = async () => {
  return { ok: true };
};
