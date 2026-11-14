migrate((app) => {
  const sessions = app.findCollectionByNameOrId("sessions")
  sessions.fields.add(new SelectField({
    name: "angleUnit",
    maxSelect: 1,
    values: ["degree", "radian"],
  }))
  app.save(sessions)
}, (app) => {
  const sessions = app.findCollectionByNameOrId("sessions")
  sessions.fields.removeByName("angleUnit")
  app.save(sessions)
})
