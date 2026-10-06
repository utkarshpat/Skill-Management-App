export class DatabaseQuotaUnavailable extends Error {
  readonly retryAfter=60;
  constructor(){super('The database free compute allowance is exhausted. Database-backed features are temporarily unavailable; signing in again will not resolve this.');}
}
// Per warm instance only: no data/access cache, and no automatic retry traffic.
export class DatabaseAvailability {
  private blockedUntil=0;
  constructor(private now=Date.now){}
  async run<T>(action:()=>Promise<T>):Promise<T>{
    if(this.now()<this.blockedUntil)throw new DatabaseQuotaUnavailable();
    try{return await action();}
    catch(error){
      if(error instanceof Error&&/monthly free amount allowance/i.test(error.message)&&/paused for the remainder of the month/i.test(error.message)){
        this.blockedUntil=this.now()+60_000;
        throw new DatabaseQuotaUnavailable();
      }
      throw error;
    }
  }
}
