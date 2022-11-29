import { SupabaseClient } from 'https://deno.land/x/supabase@1.3.1/mod.ts'
import { getEnvVariable} from "./helpers.ts"


// Create a single supabase client for interacting with your database
const supabase = new SupabaseClient(
  getEnvVariable("SUPABASE_URL")!,
  getEnvVariable("SUPABASE_SECRET")!,
  { detectSessionInUrl: false },
)

export interface Prediction {
  chat_id: number
  msg_id: number
  user_id: number
  file_id: string
  sha256: string
  is_art?: boolean
  id?: number
  created_at?: number
}

class PredictionsDatabase {
  db: SupabaseClient

  constructor(db?: SupabaseClient) {
    this.db = db || supabase
  }

  async list(): Promise<Prediction[]> {
    const { data, error } = await this.db.from('predictions').select('*')
    if (error) {
      return []
    } else {
      const predictions: Prediction[] = data
      return predictions
    }
  }

  async insert(datum: Prediction): Promise<boolean> {
    const { error } = await this.db.from('predictions').insert(datum)
    const success = error ? false : true
    return success
  }

  async exists(user_id: number, hash: string): Promise<Prediction | undefined> {
    const { data, error } = await this.db
      .from('predictions')
      .select('*')
      .match({ user_id: user_id, sha256: hash })
    if (error) {
      return
    }

    if (data.length < 1) {
      return
    } else {
      return data[0]
    }
  }

  async update(id: number, is_art: boolean): Promise<boolean> {
    const now = new Date()
    const { error } = await this.db
      .from('predictions')
      .update({ 
        is_art,
        updated_at: now.toISOString()
      })
      .eq('id', id)
    
    const success = error ? false : true
    return success
  }
}

export const database = new PredictionsDatabase(supabase)
