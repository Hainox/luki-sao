export const NO_DISTRICT_TEXT =
  'В журнале обходов вам не назначен район — фотожурнал и свод недоступны. Обратитесь к администратору журнала обходов.'

export function NoDistrictNotice({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
      <div role="alert" className="card p-6 text-slate-700">
        {NO_DISTRICT_TEXT}
      </div>
    </div>
  )
}
