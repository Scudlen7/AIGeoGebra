migrate((app) => {
  const sessions = app.findCollectionByNameOrId("sessions")
  const mode = sessions.fields.getByName("mode")
  mode.values = [...mode.values, "graphing", "cas"]
  app.save(sessions)
}, (app) => {
  const sessions = app.findCollectionByNameOrId("sessions")
  const mode = sessions.fields.getByName("mode")
  mode.values = mode.values.filter((value) => value !== "graphing" && value !== "cas")
  app.save(sessions)
})
