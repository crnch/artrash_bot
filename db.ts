import { SupabaseClient } from "https://deno.land/x/supabase@1.3.1/mod.ts"

// Create a single supabase client for interacting with your database
const url = 'https://vceryglsnfwfhzkccxly.supabase.co/'
const supabase = new SupabaseClient(
    url, 
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZXJ5Z2xzbmZ3Zmh6a2NjeGx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2Njc5Mzk5NTUsImV4cCI6MTk4MzUxNTk1NX0.OS7u62T0BmWToti9kSQFillWwMyVM0K82IqxkXZ-K7o', 
    {detectSessionInUrl: false})


export interface Prediction {
    chat_id: number,
    msg_id: number,
    user_id: number,
    file_id: string,
    sha256: string,
    is_art?: boolean
    id?: number,
    created_at?: number,
}

class PredictionsDatabase {
    db: SupabaseClient

    constructor(db?: SupabaseClient) {
        this.db = db || supabase
    }

    async list(): Promise<Prediction[]> {
        const {data, error} = await this.db.from("predictions").select("*")
        if (error) {
            return []
        } else {
            const predictions: Prediction[] = data
            return predictions
        }
    }

    async insert(datum: Prediction): Promise<boolean> {
        // TODO: doesn't check whether the user has already made a prediction for this image
        const { error } = await this.db.from("predictions").insert(datum)
        const success = error ? false : true
        return success
    }

    async exists(hash: string): Promise<Prediction | undefined> {
        const {data, error} = await this.db.from("predictions").select("*").eq("sha256", hash) 
        if (error) {
            return
        } 

        if (data.length < 1) {
            return
        } else {
            return data[0]
        }
    }
}

export const database = new PredictionsDatabase(supabase)
