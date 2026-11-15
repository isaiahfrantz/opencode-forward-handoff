import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "forward-handoff.tui",
  setup(ctx) {
    const unsubscribe = ctx.data.on("session.created", (event) => {
      const sessionID = event.data.sessionID
      const title = event.data.title
      if (sessionID && title?.startsWith("Resumed Handoff")) {
        ctx.ui.tabs.focus(sessionID)
        ctx.ui.toast.show({
          message: `Switched to ${title}`,
          variant: "info",
        })
      }
    })

    return () => {
      unsubscribe()
    }
  },
})

