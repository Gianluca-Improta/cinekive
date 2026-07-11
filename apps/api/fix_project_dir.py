import sqlite3
conn = sqlite3.connect("/data/db/cinearchive.db")
conn.execute("UPDATE projects SET video_dir=? WHERE id=?", ("nss", "8025d6be-2060-4265-92f7-537288008a1c"))
conn.commit()
print(conn.execute("SELECT id,name,slug,video_dir FROM projects").fetchall())
conn.close()
