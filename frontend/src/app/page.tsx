export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Welcome to CampusCore</h1>
        <p className="text-lg text-gray-600 mb-8">Student Portal - Course Registration Platform</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-2">Course Registration</h2>
            <p className="text-gray-600">Browse and enroll in courses for the current semester</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-2">My Enrollments</h2>
            <p className="text-gray-600">View your enrolled courses and status</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-2">Schedule</h2>
            <p className="text-gray-600">View your class timetable</p>
          </div>
        </div>
      </div>
    </main>
  );
}
