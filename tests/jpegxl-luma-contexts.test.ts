import { defineJpegXlLumaContextTests } from './helpers/jpegxl-luma-contexts-cases.ts'

// Synchronous cases and the effort gates. jpegxl-luma-contexts-async.test.ts holds the
// asynchronous half so the slow tier runs both at once.
defineJpegXlLumaContextTests(false)
